import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { Route } from "../models/Route.js";

const router = express.Router();

/**
 * GET /api/routes → List all routes (SuperAdmin only)
 */
router.get("/", auth, requireRole("superadmin"), async (_req, res) => {
  try {
    const routes = await Route.find()
      .populate("supervisor", "name email")
      .populate("rider", "name email")
      .populate("refillCoordinator", "name email")
      .lean();

    res.json({ routes });
  } catch (err) {
    console.error("List routes error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/routes → Create route (SuperAdmin only)
 */
router.post("/", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const { name, region, stops } = req.body;

    if (!name || !region || !Array.isArray(stops) || stops.length === 0) {
      return res.status(400).json({ error: "name, region, stops[] required" });
    }

    const formattedStops = stops.map(s => ({
      name: s,
      lat: null,
      lng: null,
      status: "pending"
    }));

    const route = await Route.create({
      name,
      region,
      stops: formattedStops,
      status: "Active",
      createdAt: new Date()
    });

    res.status(201).json({ ok: true, route });
  } catch (err) {
    console.error("Create route error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
