import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { Route } from "../models/Route.js";
import { User } from "../models/User.js";

const router = express.Router();

/* ------------------ GET ALL ROUTES ------------------ */
router.get("/", auth, requireRole("superadmin"), async (_req, res) => {
  try {
    const routes = await Route.find()
      .populate("supervisor", "name email")
      .populate("rider", "name email")
      .populate("refillCoordinator", "name email")
      .lean();

    res.json({ routes });   // ✅ frontend expects this!
  } catch (err) {
    console.error("List routes error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ------------------ CREATE ROUTE ------------------ */
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
      createdBy: req.user.id
    });

    res.status(201).json({ ok: true, route });
  } catch (err) {
    console.error("Create route error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ------------------ EDIT ROUTE ------------------ */
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

    res.json({ ok: true, route });
  } catch (err) {
    console.error("PATCH route error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ------------------ DELETE ROUTE ------------------ */
router.delete("/:id", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const route = await Route.findByIdAndDelete(req.params.id);
    if (!route) return res.status(404).json({ error: "Route not found" });

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE route error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
