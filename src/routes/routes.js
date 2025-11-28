import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { Route } from "../models/Route.js";
import { User } from "../models/User.js";

const router = express.Router();

/**
 * CREATE ROUTE — SUPERADMIN ONLY
 * { name, region, stops: [{name, lat?, lng?}], supervisorId }
 */
router.post("/", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const { name, region, stops = [], supervisorId } = req.body;

    if (!name || !region)
      return res.status(400).json({ error: "name and region required" });

    if (!Array.isArray(stops) || stops.length === 0)
      return res.status(400).json({ error: "At least 1 stop required" });

    // Check supervisor is valid
    let supervisor = null;
    if (supervisorId) {
      supervisor = await User.findOne({
        _id: supervisorId,
        role: "supervisor"
      });
      if (!supervisor)
        return res.status(400).json({ error: "Invalid supervisorId" });
    }

    const route = await Route.create({
      name,
      region,
      stops,
      supervisor: supervisorId || null,
      createdBy: req.user.id
    });

    res.status(201).json(route);
  } catch (err) {
    console.error("POST /routes error:", err);
    res.status(500).json({ error: "Server Error" });
  }
});

/**
 * ASSIGN SUPERVISOR (ONLY ONCE)
 */
router.patch("/:id/assign-supervisor", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const { supervisorId } = req.body;

    const route = await Route.findById(req.params.id);
    if (!route) return res.status(404).json({ error: "Route not found" });

    if (route.supervisor)
      return res.status(400).json({ error: "Supervisor already assigned to this route" });

    const sup = await User.findOne({ _id: supervisorId, role: "supervisor" });
    if (!sup) return res.status(400).json({ error: "Invalid supervisorId" });

    route.supervisor = supervisorId;
    route.updatedBy = req.user.id;
    await route.save();

    res.json(route);
  } catch (err) {
    console.error("Supervisor assignment error:", err);
    res.status(500).json({ error: "Server Error" });
  }
});

/**
 * EDIT ROUTE (name, region, stops) — SUPERADMIN ONLY
 */
router.patch("/:id", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const { name, region, stops } = req.body;

    const update = {};
    if (name) update.name = name;
    if (region) update.region = region;
    if (Array.isArray(stops)) update.stops = stops;

    update.updatedBy = req.user.id;

    const route = await Route.findByIdAndUpdate(req.params.id, update, { new: true });

    if (!route) return res.status(404).json({ error: "Route not found" });

    res.json(route);
  } catch (err) {
    console.error("PATCH /routes error:", err);
    res.status(500).json({ error: "Server Error" });
  }
});

/**
 * GET ALL ROUTES (SUPERADMIN)
 */
router.get("/", auth, requireRole("superadmin"), async (req, res) => {
  const routes = await Route.find()
    .populate("supervisor", "name email")
    .populate("rider", "name email")
    .populate("refillCoordinator", "name email")
    .lean();
  res.json(routes);
});

/**
 * DELETE ROUTE — SUPERADMIN ONLY
 */
router.delete("/:id", auth, requireRole("superadmin"), async (req, res) => {
  const route = await Route.findByIdAndDelete(req.params.id);
  if (!route) return res.status(404).json({ error: "Route not found" });
  res.json({ ok: true });
});

export default router;
