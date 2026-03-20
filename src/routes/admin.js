import express from "express";
import { ROLE_ENUM, User } from "../models/User.js";
import { auth, requireRole } from "../middleware/auth.js";
import { RegistrationRequest } from "../models/RegistrationRequest.js";
import { encryptJson, decryptJson, maskAccountNumber } from "../utils/crypto.js";
import bcrypt from "bcryptjs";
import { sendApprovalEmail, sendDeclinedEmail } from "../utils/mailer.js";
import { Team } from "../models/Team.js";
import { Route } from "../models/Route.js";
import Vehicle from "../models/Vehicle.js";
import Battery from "../models/Battery.js";

const router = express.Router();

function pickUserFields(body = {}) {
  return {
    email: body.email?.trim().toLowerCase(),
    name: body.name?.trim(),
    role: body.role?.trim(),
    password: body.password,
    disabled: typeof body.disabled === "boolean" ? body.disabled : undefined,
  };
}

// Normalize incoming fields (accept case/hyphen variants)
function normalizeUserPayload(input = {}) {
  const out = { ...input };

  // currency to uppercase among allowed
  if (out.currency != null) {
    const c = String(out.currency).toUpperCase();
    const allowed = new Set(["THB", "INR", "USD"]);
    out.currency = allowed.has(c) ? c : undefined;
  }

  // payFrequency mapping
  if (out.payFrequency != null) {
    const pf = String(out.payFrequency).toLowerCase();
    const map = {
      monthly: "Monthly",
      week: "Weekly",
      weekly: "Weekly",
      day: "Daily",
      daily: "Daily",
      hour: "Hourly",
      hourly: "Hourly",
    };
    out.payFrequency = map[pf] || undefined;
  }

  // employmentType mapping
  if (out.employmentType != null) {
    const et = String(out.employmentType).toLowerCase().replace(/\s+/g, " ");
    const map = {
      "full-time": "Full-time",
      "full time": "Full-time",
      "fulltime": "Full-time",
      "part-time": "Part-time",
      "part time": "Part-time",
      "parttime": "Part-time",
      contract: "Contract",
      gig: "Gig / On-demand",
      "on-demand": "Gig / On-demand",
      "gig / on-demand": "Gig / On-demand",
      "gig/on-demand": "Gig / On-demand",
    };
    out.employmentType = map[et] || undefined;
  }

  // numeric fields may arrive as strings
  const toNum = (v) => (v === "" || v == null ? undefined : Number(v));
  if ("baseSalary" in out) out.baseSalary = toNum(out.baseSalary);
  if ("vat" in out) out.vat = toNum(out.vat);
  if ("otRate" in out) out.otRate = toNum(out.otRate);
  if ("allowances" in out) out.allowances = toNum(out.allowances);
  if ("deductions" in out) out.deductions = toNum(out.deductions);

  // effectiveFrom to Date
  if (out.effectiveFrom != null) {
    const d = new Date(out.effectiveFrom);
    out.effectiveFrom = isNaN(d.getTime()) ? undefined : d;
  }

  // empty strings to undefined for text fields
  ["taxId", "notes"].forEach((k) => {
    if (k in out) {
      const t = (out[k] ?? "").toString().trim();
      out[k] = t === "" ? undefined : t;
    }
  });

  // bank object cleanup
  if (out.bank) {
    const b = out.bank || {};
    const clean = {
      holder: b.holder?.toString().trim() || undefined,
      account: b.account?.toString().trim() || undefined,
      bankName: b.bankName?.toString().trim() || undefined,
      ifsc: b.ifsc?.toString().trim() || undefined,
    };
    if (!clean.holder && !clean.account && !clean.bankName && !clean.ifsc) {
      out.bank = undefined;
    } else {
      out.bank = clean;
    }
  }

  return out;
}

/* ========================================
   USER MANAGEMENT (Superadmin only)
======================================== */

// CREATE user
router.post("/users", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const { email, name, role, password, disabled } = pickUserFields(req.body);
    if (!email || !name || !role || !password)
      return res.status(400).json({ error: "email, name, role, password are required" });
    if (!ROLE_ENUM.includes(role))
      return res.status(400).json({ error: `role must be one of: ${ROLE_ENUM.join(", ")}` });

    const exists = await User.findOne({ email }).lean();
    if (exists) return res.status(409).json({ error: "Email already exists" });

    const user = new User({ email, name, role, disabled: !!disabled, passwordHash: "temp" });
    await user.setPassword(password); // hashes
    await user.save();

    res.status(201).json({ user: { _id: user._id, email, name, role, disabled: user.disabled } });
  } catch (e) {
    console.error("Create user error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// LIST users
router.get("/users", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const filter = {};
    if (req.query.role) filter.role = req.query.role;
    const users = await User.find(filter)
      .select("_id name email role disabled createdAt")
      .sort({ createdAt: -1 })
      .lean();
    res.json({ users });
  } catch (e) {
    console.error("List users error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// UPDATE user
router.patch("/users/:id", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const { name, role, password, disabled } = pickUserFields(req.body);
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    // safety: don't demote the last superadmin
    const isDemotingLastSuperadmin =
      user.role === "superadmin" &&
      role && role !== "superadmin" &&
      (await User.countDocuments({ role: "superadmin", _id: { $ne: user._id } })) === 0;
    if (isDemotingLastSuperadmin)
      return res.status(400).json({ error: "Cannot demote the last superadmin" });

    if (name) user.name = name;
    if (role) {
      if (!ROLE_ENUM.includes(role))
        return res.status(400).json({ error: `role must be one of: ${ROLE_ENUM.join(", ")}` });
      user.role = role;
    }
    if (typeof disabled === "boolean") user.disabled = disabled;
    if (password) await user.setPassword(password);

    await user.save();
    res.json({ user: { _id: user._id, email: user.email, name: user.name, role: user.role, disabled: user.disabled } });
  } catch (e) {
    console.error("Update user error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE user
router.delete("/users/:id", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.role === "superadmin") {
      const others = await User.countDocuments({ role: "superadmin", _id: { $ne: user._id } });
      if (others === 0) return res.status(400).json({ error: "Cannot delete the last superadmin" });
    }

    await user.deleteOne();
    res.json({ ok: true });
  } catch (e) {
    console.error("Delete user error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

/* ========================================
   REGISTRATION REQUESTS
======================================== */

// GET count of pending requests
router.get("/requests/count", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const count = await RegistrationRequest.countDocuments();
    res.json({ count });
  } catch (err) {
    console.error("Count requests error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET all registration requests
router.get("/requests", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const items = await RegistrationRequest.find().sort({ createdAt: -1 }).lean();
    res.json({ items });
  } catch (err) {
    console.error("List requests error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST approve request
router.post("/requests/:id/approve", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const doc = await RegistrationRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    if (typeof doc.approve !== "function") {
      return res.status(500).json({ error: "RegistrationRequest.approve() not implemented" });
    }
    const user = await doc.approve();
    
    let emailSent = false;
    try {
      const result = await sendApprovalEmail(user.email, user.name, user.role);
      emailSent = !!result?.sent;
    } catch (err) {
      console.error("sendApprovalEmail error:", err);
    }

    return res.json({
      ok: true, emailSent, user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (err) {
    console.error("Approve request error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST decline request
router.post("/requests/:id/decline", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const doc = await RegistrationRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    const { email, name } = doc;
    await doc.deleteOne();

    let emailSent = false;
    try {
      const result = await sendDeclinedEmail(email, name);
      emailSent = !!result?.sent;
    } catch (err) {
      console.error("sendDeclinedEmail error:", err);
    }

    return res.json({ ok: true, emailSent });
  } catch (err) {
    console.error("Decline request error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/* ========================================
   TEAM MANAGEMENT (Superadmin only)
   RULES:
   - Routes: Can be shared between multiple teams ✅
   - All other resources: Must be unique per team ❌
======================================== */

// GET all teams with populated data
router.get("/teams", auth, requireRole("superadmin"), async (_req, res) => {
  try {
    const teams = await Team.find({})
      .sort({ createdAt: -1 })
      .populate([
        { path: "supervisors", select: "name email role" },
        { path: "riders", select: "name email role" },
        { path: "cooks", select: "name email role" },
        { path: "refillCoordinators", select: "name email role" },
        { path: "vehicles", select: "name registrationNo status" },
        { path: "batteries", select: "imei status type capacity" },
        { path: "routes", select: "name region status" }
      ])
      .lean();

    const items = teams.map(t => ({
      id: String(t._id),
      name: t.name,
      created: t.createdAt?.toISOString?.().slice(0, 10),
      
      // Users (must be unique per team)
      supervisors: t.supervisors?.map(u => ({ id: String(u._id), name: u.name, email: u.email })) || [],
      riders: t.riders?.map(u => ({ id: String(u._id), name: u.name, email: u.email })) || [],
      cooks: t.cooks?.map(u => ({ id: String(u._id), name: u.name, email: u.email })) || [],
      refillCoordinators: t.refillCoordinators?.map(u => ({ id: String(u._id), name: u.name, email: u.email })) || [],
      
      // Vehicles (must be unique per team)
      vehicles: t.vehicles?.map(v => ({
        id: String(v._id),
        name: v.name,
        registrationNo: v.registrationNo,
        status: v.status
      })) || [],
      
      // Batteries (must be unique per team)
      batteries: t.batteries?.map(b => ({
        id: String(b._id),
        imei: b.imei,
        status: b.status,
        type: b.type,
        capacity: b.capacity
      })) || [],
      
      // ROUTES (can be shared between teams - no uniqueness constraint)
      routes: t.routes?.map(r => ({
        id: String(r._id),
        name: r.name,
        region: r.region,
        status: r.status
      })) || [],
    }));

    res.json({ items });
  } catch (err) {
    console.error("List teams error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// CREATE new team
router.post("/teams", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const {
      name,
      supervisors = [],
      riders = [],
      cooks = [],
      refillCoordinators = [],
      vehicles = [],
      batteries = [],
      routes = []  // ROUTES CAN BE SHARED - no validation needed
    } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({ error: "Team name is required" });
    }

    // 1️⃣ CHECK VEHICLES - must be unique per team
    const takenVehicles = await Vehicle.find({
      _id: { $in: vehicles },
      team: { $exists: true, $ne: null }
    });
    if (takenVehicles.length) {
      return res.status(400).json({
        error: "Some vehicles already belong to another team",
        vehicles: takenVehicles.map(v => ({ id: v._id, name: v.name }))
      });
    }

    // 2️⃣ CHECK BATTERIES - must be unique per team
    const takenBatteries = await Battery.find({
      _id: { $in: batteries },
      team: { $exists: true, $ne: null }
    });
    if (takenBatteries.length) {
      return res.status(400).json({
        error: "Some batteries already belong to another team",
        batteries: takenBatteries.map(b => ({ id: b._id, imei: b.imei }))
      });
    }

    // 3️⃣ CHECK COOKS - must be unique per team
    const takenCooks = await Team.find({
      cooks: { $in: cooks }
    });
    if (takenCooks.length) {
      const conflictingCooks = await User.find({ _id: { $in: cooks } });
      return res.status(400).json({
        error: "Some cooks are already assigned to another team",
        cooks: conflictingCooks.map(c => ({ id: c._id, name: c.name, email: c.email }))
      });
    }

    // 4️⃣ CHECK RIDERS - must be unique per team
    const takenRiders = await Team.find({
      riders: { $in: riders }
    });
    if (takenRiders.length) {
      const conflictingRiders = await User.find({ _id: { $in: riders } });
      return res.status(400).json({
        error: "Some riders are already assigned to another team",
        riders: conflictingRiders.map(r => ({ id: r._id, name: r.name, email: r.email }))
      });
    }

    // 5️⃣ CHECK SUPERVISORS - must be unique per team
    const takenSupervisors = await Team.find({
      supervisors: { $in: supervisors }
    });
    if (takenSupervisors.length) {
      const conflictingSupervisors = await User.find({ _id: { $in: supervisors } });
      return res.status(400).json({
        error: "Some supervisors are already assigned to another team",
        supervisors: conflictingSupervisors.map(s => ({ id: s._id, name: s.name, email: s.email }))
      });
    }

    // 6️⃣ CHECK REFILL COORDINATORS - must be unique per team
    const takenRefillCoords = await Team.find({
      refillCoordinators: { $in: refillCoordinators }
    });
    if (takenRefillCoords.length) {
      const conflictingRefills = await User.find({ _id: { $in: refillCoordinators } });
      return res.status(400).json({
        error: "Some refill coordinators are already assigned to another team",
        refillCoordinators: conflictingRefills.map(r => ({ id: r._id, name: r.name, email: r.email }))
      });
    }

    // ✅ ROUTES - NO CHECKS! They can be shared between teams

    // Create team
    const team = await Team.create({
      name,
      supervisors,
      riders,
      cooks,
      refillCoordinators,
      vehicles,
      batteries,
      routes
    });

    // Assign vehicles & batteries (update their team field)
    if (vehicles.length) {
      await Vehicle.updateMany(
        { _id: { $in: vehicles } },
        { $set: { team: team._id } }
      );
    }

    if (batteries.length) {
      await Battery.updateMany(
        { _id: { $in: batteries } },
        { $set: { team: team._id } }
      );
    }

    // ✅ Update routes - add this team to their teams array (routes can be shared)
    if (routes.length) {
      await Route.updateMany(
        { _id: { $in: routes } },
        { $addToSet: { teams: team._id } }  // Add to teams array without duplicates
      );
    }

    res.status(201).json({ 
      ok: true, 
      id: String(team._id),
      message: "Team created successfully"
    });

  } catch (err) {
    console.error("Create team error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

// UPDATE team
router.patch("/teams/:id", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const {
      name, 
      supervisors = [], 
      riders = [], 
      cooks = [],
      refillCoordinators = [],
      vehicles = [], 
      batteries = [], 
      routes = []  // ROUTES CAN BE SHARED
    } = req.body;

    const team = await Team.findById(req.params.id);
    if (!team) return res.status(404).json({ error: "Team not found" });

    // 1️⃣ UNASSIGN old vehicles & batteries
    if (team.vehicles?.length) {
      await Vehicle.updateMany(
        { _id: { $in: team.vehicles } },
        { $set: { team: null } }
      );
    }

    if (team.batteries?.length) {
      await Battery.updateMany(
        { _id: { $in: team.batteries } },
        { $set: { team: null } }
      );
    }

    // 2️⃣ CHECK NEW VEHICLES - must be unique (excluding current team)
    const takenVehicles = await Vehicle.find({
      _id: { $in: vehicles },
      team: { $exists: true, $ne: null, $ne: team._id }
    });
    if (takenVehicles.length) {
      return res.status(400).json({ 
        error: "Some vehicles already belong to another team",
        vehicles: takenVehicles.map(v => ({ id: v._id, name: v.name }))
      });
    }

    // 3️⃣ CHECK NEW BATTERIES - must be unique (excluding current team)
    const takenBatteries = await Battery.find({
      _id: { $in: batteries },
      team: { $exists: true, $ne: null, $ne: team._id }
    });
    if (takenBatteries.length) {
      return res.status(400).json({ 
        error: "Some batteries already belong to another team",
        batteries: takenBatteries.map(b => ({ id: b._id, imei: b.imei }))
      });
    }

    // 4️⃣ CHECK COOKS - must be unique (excluding current team)
    const takenCooks = await Team.find({
      _id: { $ne: team._id },
      cooks: { $in: cooks }
    });
    if (takenCooks.length) {
      const conflictingCooks = await User.find({ _id: { $in: cooks } });
      return res.status(400).json({
        error: "Some cooks are already assigned to another team",
        cooks: conflictingCooks.map(c => ({ id: c._id, name: c.name, email: c.email }))
      });
    }

    // 5️⃣ CHECK RIDERS - must be unique (excluding current team)
    const takenRiders = await Team.find({
      _id: { $ne: team._id },
      riders: { $in: riders }
    });
    if (takenRiders.length) {
      const conflictingRiders = await User.find({ _id: { $in: riders } });
      return res.status(400).json({
        error: "Some riders are already assigned to another team",
        riders: conflictingRiders.map(r => ({ id: r._id, name: r.name, email: r.email }))
      });
    }

    // 6️⃣ CHECK SUPERVISORS - must be unique (excluding current team)
    const takenSupervisors = await Team.find({
      _id: { $ne: team._id },
      supervisors: { $in: supervisors }
    });
    if (takenSupervisors.length) {
      const conflictingSupervisors = await User.find({ _id: { $in: supervisors } });
      return res.status(400).json({
        error: "Some supervisors are already assigned to another team",
        supervisors: conflictingSupervisors.map(s => ({ id: s._id, name: s.name, email: s.email }))
      });
    }

    // 7️⃣ CHECK REFILL COORDINATORS - must be unique (excluding current team)
    const takenRefillCoords = await Team.find({
      _id: { $ne: team._id },
      refillCoordinators: { $in: refillCoordinators }
    });
    if (takenRefillCoords.length) {
      const conflictingRefills = await User.find({ _id: { $in: refillCoordinators } });
      return res.status(400).json({
        error: "Some refill coordinators are already assigned to another team",
        refillCoordinators: conflictingRefills.map(r => ({ id: r._id, name: r.name, email: r.email }))
      });
    }

    // ✅ ROUTES - NO CHECKS! They can be shared

    // Assign new vehicles & batteries
    if (vehicles.length) {
      await Vehicle.updateMany(
        { _id: { $in: vehicles } },
        { $set: { team: team._id } }
      );
    }

    if (batteries.length) {
      await Battery.updateMany(
        { _id: { $in: batteries } },
        { $set: { team: team._id } }
      );
    }

    // ✅ Handle routes - update teams array (routes can be shared)
    const oldRouteIds = (team.routes || []).map(String);
    const newRouteIds = (routes || []).map(String);

    // Remove this team from routes that are no longer assigned
    const removed = oldRouteIds.filter(id => !newRouteIds.includes(id));
    if (removed.length) {
      await Route.updateMany(
        { _id: { $in: removed } },
        { $pull: { teams: team._id } }
      );
    }

    // Add this team to newly assigned routes
    const added = newRouteIds.filter(id => !oldRouteIds.includes(id));
    if (added.length) {
      await Route.updateMany(
        { _id: { $in: added } },
        { $addToSet: { teams: team._id } }
      );
    }

    // Update team fields
    if (name) team.name = name;
    team.supervisors = supervisors;
    team.riders = riders;
    team.cooks = cooks;
    team.refillCoordinators = refillCoordinators;
    team.vehicles = vehicles;
    team.batteries = batteries;
    team.routes = routes;

    await team.save();

    res.json({ 
      ok: true, 
      message: "Team updated successfully" 
    });

  } catch (err) {
    console.error("Update team error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

// DELETE team
router.delete("/teams/:id", auth, requireRole("superadmin"), async (req, res) => {
  try {
    console.log("========== DELETE TEAM REQUEST ==========");
    console.log("1. Team ID to delete:", req.params.id);
    
    const team = await Team.findById(req.params.id);
    if (!team) {
      return res.status(404).json({ error: "Team not found" });
    }

    // Unassign vehicles
    if (team.vehicles?.length) {
      await Vehicle.updateMany(
        { _id: { $in: team.vehicles } },
        { $set: { team: null } }
      );
    }

    // Unassign batteries
    if (team.batteries?.length) {
      await Battery.updateMany(
        { _id: { $in: team.batteries } },
        { $set: { team: null } }
      );
    }

    // ✅ Remove this team from routes (routes can be shared, so just remove this team)
    if (team.routes?.length) {
      await Route.updateMany(
        { _id: { $in: team.routes } },
        { $pull: { teams: team._id } }
      );
    }

    await team.deleteOne();
    console.log("Team deleted successfully");
    console.log("========== DELETE COMPLETE ==========");

    res.status(200).json({ 
      success: true, 
      message: "Team deleted successfully",
      ok: true 
    });
    
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

// POST assign routes to team
router.post("/teams/:id/assign-routes", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const { routeIds = [] } = req.body;

    const team = await Team.findById(req.params.id);
    if (!team) return res.status(404).json({ error: "Team not found" });

    // ✅ ROUTES CAN BE SHARED - no validation needed

    // Add this team to routes
    if (routeIds.length) {
      await Route.updateMany(
        { _id: { $in: routeIds } },
        { $addToSet: { teams: team._id } }
      );
    }

    team.routes = routeIds;
    await team.save();

    res.json({ ok: true, message: "Routes assigned successfully" });

  } catch (err) {
    console.error("Assign routes error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST assign users to route (Supervisor only)
router.post("/routes/:id/assign-users", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const { riderId, refillId } = req.body;

    const route = await Route.findById(req.params.id);
    if (!route) return res.status(404).json({ error: "Route not found" });

    // ✅ Supervisor must belong to at least one team that has this route
    const teams = await Team.find({ 
      _id: { $in: route.teams || [] },
      supervisors: req.user.id 
    });

    if (!teams.length) {
      return res.status(403).json({ error: "You are not supervisor of any team assigned to this route" });
    }

    // Get all teams this route belongs to
    const routeTeams = await Team.find({ _id: { $in: route.teams || [] } });

    // Validate rider
    if (riderId) {
      const rider = await User.findById(riderId);
      if (!rider || rider.role !== "rider") {
        return res.status(400).json({ error: "Invalid rider" });
      }

      // Check if rider belongs to any of the route's teams
      const riderInTeam = routeTeams.some(t => 
        (t.riders || []).some(r => String(r) === String(riderId))
      );

      if (!riderInTeam) {
        return res.status(400).json({ error: "Rider not part of any team assigned to this route" });
      }
    }

    // Validate refill coordinator
    if (refillId) {
      const refill = await User.findById(refillId);
      if (!refill || refill.role !== "refill") {
        return res.status(400).json({ error: "Invalid refill coordinator" });
      }

      // Check if refill belongs to any of the route's teams
      const refillInTeam = routeTeams.some(t => 
        (t.refillCoordinators || []).some(r => String(r) === String(refillId))
      );

      if (!refillInTeam) {
        return res.status(400).json({ error: "Refill coordinator not part of any team assigned to this route" });
      }
    }

    route.rider = riderId || null;
    route.refillCoordinator = refillId || null;
    route.supervisor = req.user.id; // Track who assigned

    await route.save();

    res.json({ ok: true, message: "Users assigned successfully" });
  } catch (err) {
    console.error("Assign users error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET list of all routes (for assigning to teams)
router.get("/routes/list", auth, requireRole("superadmin"), async (_req, res) => {
  try {
    const routes = await Route.find({})
      .select("_id name region status teams")
      .populate("teams", "name")
      .lean();

    res.json({ routes });
  } catch (err) {
    console.error("List routes error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;