// src/routes/admin.js
import express from "express";
import { ROLE_ENUM, User } from "../models/User.js";
import { auth, requireRole } from "../middleware/auth.js";
import { RegistrationRequest } from "../models/RegistrationRequest.js";
// import User from "../models/User.js"; // default export in your project
import { encryptJson, decryptJson, maskAccountNumber } from "../utils/crypto.js";
import bcrypt from "bcryptjs";
import { sendApprovalEmail , sendDeclinedEmail } from "../utils/mailer.js";
import { Team } from "../models/Team.js";
import { Route } from "../models/Route.js";
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

// UPDATE user (name/role/disabled/password)
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

// DELETE user (safety: can’t delete the last superadmin)
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



/* -------------------------------------------
   Registration Requests (you already had these)
-------------------------------------------- */

/* -----------------------------
   Users (for SuperAdmin screens)
------------------------------ */


/** GET /api/admin/requests/count - get count of pending requests for notification */
router.get("/requests/count", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const count = await RegistrationRequest.countDocuments();
    res.json({ count });
  } catch (err) {
    console.error("Count requests error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/** GET /api/admin/requests */
router.get("/requests", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const items = await RegistrationRequest.find().sort({ createdAt: -1 }).lean();
    res.json({ items });
  } catch (err) {
    console.error("List requests error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/** POST /api/admin/requests/:id/approve */
router.post("/requests/:id/approve", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const doc = await RegistrationRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    // Prefer model method if defined (hashes password, creates user, deletes request)
    if (typeof doc.approve !== "function") {
      return res.status(500).json({ error: "RegistrationRequest.approve() not implemented" });
    }
    const user = await doc.approve();
        // Try sending the approval email; don't fail the API if email fails
    let emailSent = false;
    try {
      const result = await sendApprovalEmail(user.email, user.name, user.role);
      emailSent = !!result?.sent;
    } catch (err) {
      console.error("sendApprovalEmail error:", err);
    }

    return res.json({ ok: true, emailSent, user: {
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role
    }});
  } catch (err) {
    console.error("Approve request error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/** POST /api/admin/requests/:id/decline */
router.post("/requests/:id/decline", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const doc = await RegistrationRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    const { email, name } = doc;

    // delete pending request
    await doc.deleteOne();

    // try to send decline email (don’t fail API if email fails)
    let emailSent = false;
    try {
      const result = await sendDeclinedEmail(email, name);
      emailSent = !!result?.sent;
    } catch (err) {
      console.error("sendDeclinedEmail error:", err);
    }

    // send ONE response, at the end
    return res.json({ ok: true, emailSent });
  } catch (err) {
    console.error("Decline request error:", err);
    // send ONE error response
    return res.status(500).json({ error: "Server error" });
  }
});


//Team management 


/** GET /api/admin/teams — list teams (populated members) */
router.get("/teams", auth, requireRole("superadmin"), async (_req, res) => {
  try {
    const teams = await Team.find({})
      .sort({ createdAt: -1 })
   .populate([
  { path: "supervisors", select: "name email role" },
  { path: "riders", select: "name email role" },
  { path: "cooks", select: "name email role" },
  { path: "refillCoordinators", select: "name email role" },
  { path: "refillStaff", select: "name email role" },
])

      .lean();

    // Shape for the app: names + ids, created date, (optional) routes count if you add later
 const items = teams.map(t => ({
  id: String(t._id),
  name: t.name,
  created: t.createdAt?.toISOString?.().slice(0,10),
  routes: t.routes?.length || 0,

  supervisors: t.supervisors?.map(u => ({ id: String(u._id), name: u.name })) || [],
  riders: t.riders?.map(u => ({ id: String(u._id), name: u.name })) || [],
  cooks: t.cooks?.map(u => ({ id: String(u._id), name: u.name })) || [],
  refillCoordinators: t.refillCoordinators?.map(u => ({ id: u._id, name: u.name })) || [],
  refillStaff: t.refillStaff?.map(u => ({ id: u._id, name: u.name })) || [],
}));


    res.json({ items });
  } catch (err) {
    console.error("List teams error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/teams", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const { name, supervisors = [], riders = [], cooks = [], routes = [] } = req.body;

    const team = await Team.create({ name, supervisors, riders, cooks });

    // Assign routes to this team
    if (routes.length > 0) {
      await Route.updateMany(
        { _id: { $in: routes }, team: null },
        {
          $set: {
            team: team._id,
            supervisor: supervisors[0] || null
          }
        }
      );

      team.routes = routes;
      await team.save();
    }

    res.status(201).json({ ok: true, id: String(team._id) });
  } catch (err) {
    console.error("Create team error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


/** PATCH /api/admin/teams/:id — update team */
router.patch("/teams/:id", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const allow = ["name", "supervisors", "riders", "cooks","refillCoordinators",
  "refillStaff"];
    const update = {};
    for (const k of allow) if (k in req.body) update[k] = req.body[k];

    const team = await Team.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!team) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Update team error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/** DELETE /api/admin/teams/:id — remove team */
router.delete("/teams/:id", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
    if (!team) return res.status(404).json({ error: "Not found" });
    await team.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete team error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/teams/:id/assign-routes", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const { routeIds = [] } = req.body;

    const team = await Team.findById(req.params.id);
    if (!team) return res.status(404).json({ error: "Team not found" });

    // Prevent assigning routes that already belong to another team
    const existing = await Route.find({
      _id: { $in: routeIds },
      team: { $ne: null }
    });

    if (existing.length) {
      return res.status(400).json({
        error: "Some routes are already assigned to another team",
        routes: existing.map(r => ({ id: r._id, name: r.name }))
      });
    }

    // Assign routes → add supervisor
    await Route.updateMany(
      { _id: { $in: routeIds } },
      {
        $set: {
          team: team._id,
          supervisor: team.supervisors[0] || null
        }
      }
    );

    team.routes = routeIds;
    await team.save();

    res.json({ ok: true, message: "Routes assigned successfully" });

  } catch (err) {
    console.error("Assign routes error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/routes/:id/assign-users", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const { riderId, refillId } = req.body;

    const route = await Route.findById(req.params.id);
    if (!route) return res.status(404).json({ error: "Route not found" });

    // Only supervisor of this team can assign
    if (String(route.supervisor) !== String(req.user.id)) {
      return res.status(403).json({ error: "You are not assigned as supervisor for this route" });
    }

    route.rider = riderId || null;
    route.refillCoordinator = refillId || null;

    await route.save();

    res.json({ ok: true, message: "Users assigned successfully" });
  } catch (err) {
    console.error("Assign riders error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


export default router;
