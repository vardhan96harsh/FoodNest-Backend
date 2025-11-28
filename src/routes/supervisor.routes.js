import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { Team } from "../models/Team.js";
import { Route } from "../models/Route.js";
import { User } from "../models/User.js";

const router = express.Router();

/**
 * Supervisor assigns rider or refill coordinator to a route
 */
router.post("/assign-user", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const { routeId, userId, type } = req.body; // type = "rider" or "refill"

    if (!routeId || !userId || !type)
      return res.status(400).json({ error: "routeId, userId, type are required" });

    const route = await Route.findById(routeId);
    if (!route) return res.status(404).json({ error: "Route not found" });

    // Supervisor must be the assigned supervisor of this route
    if (String(route.supervisor) !== String(req.user.id)) {
      return res.status(403).json({ error: "You are not the supervisor for this route" });
    }

    // Validate user exists
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Validate role based on type
    if (type === "rider" && user.role !== "rider") {
      return res.status(400).json({ error: "Selected user is not a rider" });
    }
    if (type === "refill" && user.role !== "refill") {
      return res.status(400).json({ error: "Selected user is not a refill coordinator" });
    }

    // Assign user into route
    if (type === "rider") route.rider = userId;
    if (type === "refill") route.refillCoordinator = userId;

    await route.save();

    res.json({
      ok: true,
      message: "User assigned successfully",
      route
    });
  } catch (err) {
    console.error("Assign user error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
