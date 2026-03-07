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

    res.json({ routes });
  } catch (err) {
    console.error("List routes error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ------------------ GET ROUTES LIST (FOR TEAM ASSIGNMENT) ------------------ */
router.get("/list", auth, requireRole("superadmin"), async (_req, res) => {
  try {
    const routes = await Route.find({})
      .select("_id name") // Only get id and name
      .lean();

    res.json({ routes });
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
      return res.status(400).json({ error: "name, region & stops[] required" });
    }

    const formattedStops = stops.map(s => {
      if (isNaN(s.lat) || isNaN(s.lng)) {
        return res.status(400).json({ error: "Latitude and Longitude must be valid numbers" });
      }
      return {
        name: s.name || "Unnamed Stop",
        lat: Number(s.lat),
        lng: Number(s.lng),
        status: "pending"
      };
    });

    const route = await Route.create({
      name,
      region,
      stops: formattedStops,
      status: "Active",
      createdBy: req.user.id
    });

    res.status(201).json({ ok: true, route });
  } catch (err) {
    console.error("Create route error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

/* ------------------ EDIT ROUTE ------------------ */
router.patch("/:id", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const { name, region, stops } = req.body;

    const update = {};

    if (name) update.name = name;
    if (region) update.region = region;

    if (Array.isArray(stops)) {
      update.stops = stops.map(s => {
        if (!s.name || isNaN(s.lat) || isNaN(s.lng)) {
          throw new Error("Each stop must have a valid name, latitude, and longitude");
        }
        return {
          name: s.name,
          lat: s.lat ?? null,
          lng: s.lng ?? null,
          status: s.status || "pending"
        };
      });
    }

    update.updatedBy = req.user.id;

    const route = await Route.findByIdAndUpdate(req.params.id, update, { new: true });

    if (!route) {
      return res.status(404).json({ error: "Route not found" });
    }

    res.json({ ok: true, route });
  } catch (err) {
    console.error("PATCH route error:", err.message);
    res.status(500).json({ error: `Failed to update route: ${err.message}` });
  }
});

/* ------------------ DELETE ROUTE ------------------ */
router.delete("/:id", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const route = await Route.findByIdAndDelete(req.params.id);
    if (!route) {
      return res.status(404).json({ error: "Route not found" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE route error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;