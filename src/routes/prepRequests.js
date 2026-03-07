// src/routes/prepRequests.js
import express from "express";
import { PrepRequest } from "../models/PrepRequest.js";
import { FoodItem } from "../models/FoodItem.js";
import { auth } from "../middleware/auth.js";
import { User } from "../models/User.js";        // ← ADD THIS
import { Team } from "../models/Team.js";   

const router = express.Router();

// Small helper: allow multiple roles
function permit(...roles) {
  return (req, res, next) => {
    const r = req.user?.role;
    if (!r || !roles.includes(r)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}

/**
 * POST /api/prep-requests
 * body: { foodId, cookId, quantityToPrepare? }
 * roles: supervisor OR superadmin
 */
router.post("/", permit("supervisor", "superadmin"), async (req, res) => {
  try {
    const { foodId, cookId, quantityToPrepare } = req.body || {};

    const food = await FoodItem.findById(foodId).lean();
    if (!food) return res.status(404).json({ error: "Food not found" });

    // 🔴 NEW CODE: Team validation
    // Get the supervisor's teams
    const supervisor = await User.findById(req.user.id);
    
    // Get the cook's teams
    const cook = await User.findById(cookId);
    if (!cook) return res.status(404).json({ error: "Cook not found" });
    
    // If user is supervisor (not superadmin), validate team membership
    if (req.user.role === "supervisor") {
      // Get all teams where this user is a supervisor
      const supervisorTeams = await Team.find({ 
        supervisors: req.user.id 
      }).select("_id");
      
      const supervisorTeamIds = supervisorTeams.map(t => t._id.toString());
      
      // Get all teams where this cook belongs (as cook)
      const cookTeams = await Team.find({ 
        cooks: cookId 
      }).select("_id");
      
      const cookTeamIds = cookTeams.map(t => t._id.toString());
      
      // Check if they share at least one team
      const hasCommonTeam = supervisorTeamIds.some(teamId => 
        cookTeamIds.includes(teamId)
      );
      
      if (!hasCommonTeam) {
        return res.status(403).json({ 
          error: "Cook must be in the same team as you" 
        });
      }
    }
    // Superadmin can assign to anyone (skip validation)

    const doc = await PrepRequest.create({
      foodId,
      cookId,
      requestedBy: req.user.id,
      quantityToPrepare: typeof quantityToPrepare === "number" ? quantityToPrepare : 0,
      foodSnapshot: {
        name: food.name,
        price: food.price,
        category: food.category,
        tax: food.tax,
        available: food.available,
        imageUrl: food.imageUrl,
        rawMaterials: food.rawMaterials || [],
        totalQuantity: food.totalQuantity || undefined,
        perServing: food.perServing || undefined,
      },
    });

    const created = await PrepRequest.findById(doc._id)
      .populate("requestedBy", "name email")
      .populate("cookId", "name email")
      .lean();

    res.status(201).json(doc);
  } catch (e) {
    console.error("Create prep request error:", e);
    res.status(500).json({ error: "Server error" });
  }
});
/**
 * GET /api/prep-requests?cookId=...&status=...
 * roles: any authenticated user (cook will call this)
 */
router.get("/",auth, async (req, res) => {
  try {
    const q = {};
    if (req.query.cookId) q.cookId = req.query.cookId;
    if (req.query.createdBy) q.requestedBy = req.query.createdBy;
    if (req.query.status) q.status = req.query.status;

    // IMPORTANT: populate both sides so UI can show names/emails
    const rows = await PrepRequest.find(q)
      .sort({ createdAt: -1 })
      .populate("requestedBy", "name email")  // <— show supervisor
      .populate("cookId", "name email")       // <— show cook
      .lean();

    res.json(rows);
  } catch (e) {
    console.error("List prep requests error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * PATCH /api/prep-requests/:id
 * body: { status?, quantityToPrepare? }
 * roles: cook can update own cards; supervisor/superadmin can also adjust
 */
router.patch("/:id", async (req, res) => {
  try {
    const { status, quantityToPrepare } = req.body || {};
    const update = {};

    if (status && ["queued", "processing", "ready", "picked"].includes(status)) {
      update.status = status;
    }
    if (typeof quantityToPrepare === "number") {
      update.quantityToPrepare = quantityToPrepare;
    }

    const doc = await PrepRequest.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
    if (!doc) return res.status(404).json({ error: "Not found" });

    res.json(doc);

    const updated = await PrepRequest.findByIdAndUpdate(
      id,
      {
        ...(status ? { status } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(typeof quantityToPrepare === "number" ? { quantityToPrepare } : {}),
      },
      { new: true }
    )
      .populate("requestedBy", "name email")
      .populate("cookId", "name email")
      .lean();

    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (e) {
    console.error("Update prep request error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/prep-requests/:id
// Allowed: the assigned cook OR supervisor/superadmin
router.delete("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const me = req.user; // set by your auth middleware

    const doc = await PrepRequest.findById(id).lean();
    if (!doc) return res.status(404).json({ error: "Not found" });

    const isSupervisor = me?.role === "supervisor" || me?.role === "superadmin";
    const isAssignedCook = String(doc.cookId) === String(me?.id);

    if (!isSupervisor && !isAssignedCook) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await PrepRequest.findByIdAndDelete(id);
    res.json({ ok: true, deletedId: id });
  } catch (e) {
    console.error("Delete prep request error:", e);
    res.status(500).json({ error: "Server error" });
  }
});


export default router;
