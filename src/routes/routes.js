import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { Route } from "../models/Route.js";
import mongoose from "mongoose";

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
      .select("_id name stops")
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
    const { name, region, stops, description } = req.body;

    if (!name || !region || !Array.isArray(stops) || stops.length === 0) {
      return res.status(400).json({ error: "name, region & stops[] required" });
    }

    // Format stops with proper structure and generate IDs
    const formattedStops = stops.map((stop, index) => {
      // Validate coordinates
      if (stop.lat !== undefined && stop.lng !== undefined) {
        if (isNaN(stop.lat) || isNaN(stop.lng)) {
          throw new Error("Latitude and Longitude must be valid numbers");
        }
      }
      
      return {
        _id: new mongoose.Types.ObjectId(),
        name: stop.name || `Stop ${index + 1}`,
        address: stop.address || "",
        lat: stop.lat || null,
        lng: stop.lng || null,
        order: stop.order || index,
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date()
      };
    });

    const route = await Route.create({
      name,
      region,
      description: description || "",
      stops: formattedStops,
      status: "Active",
      createdBy: req.user.id,
      createdAt: new Date()
    });

    res.status(201).json({ 
      ok: true, 
      route,
      message: "Route created successfully"
    });
  } catch (err) {
    console.error("Create route error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

/* ------------------ GET SINGLE ROUTE ------------------ */
router.get("/:id", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const route = await Route.findById(req.params.id)
      .populate("supervisor", "name email")
      .populate("rider", "name email")
      .populate("refillCoordinator", "name email")
      .populate("createdBy", "name email")
      .lean();

    if (!route) {
      return res.status(404).json({ error: "Route not found" });
    }

    res.json({ ok: true, route });
  } catch (err) {
    console.error("Get route error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ------------------ EDIT ROUTE ------------------ */
router.patch("/:id", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const { name, region, stops, description, status } = req.body;

    const update = {
      updatedBy: req.user.id,
      updatedAt: new Date()
    };

    if (name) update.name = name;
    if (region) update.region = region;
    if (description !== undefined) update.description = description;
    if (status) update.status = status;

    if (Array.isArray(stops)) {
      // Format stops while preserving existing IDs
      update.stops = stops.map((stop, index) => {
        // Validate coordinates if provided
        if (stop.lat !== undefined && stop.lng !== undefined) {
          if (isNaN(stop.lat) || isNaN(stop.lng)) {
            throw new Error("Latitude and Longitude must be valid numbers");
          }
        }
        
        return {
          _id: stop._id || new mongoose.Types.ObjectId(),
          name: stop.name || `Stop ${index + 1}`,
          address: stop.address || "",
          lat: stop.lat || null,
          lng: stop.lng || null,
          order: stop.order || index,
          status: stop.status || "pending",
          updatedAt: new Date()
        };
      });
    }

    const route = await Route.findByIdAndUpdate(
      req.params.id, 
      update, 
      { new: true, runValidators: true }
    );

    if (!route) {
      return res.status(404).json({ error: "Route not found" });
    }

    res.json({ ok: true, route, message: "Route updated successfully" });
  } catch (err) {
    console.error("PATCH route error:", err.message);
    res.status(500).json({ error: `Failed to update route: ${err.message}` });
  }
});

/* ------------------ DELETE ROUTE ------------------ */
router.delete("/:id", auth, requireRole("superadmin"), async (req, res) => {
  try {
    // Dynamically import DailyAssignment to avoid circular dependency
    const { DailyAssignment } = await import("../models/DailyAssignment.js");
    const activeAssignments = await DailyAssignment.findOne({
      route: req.params.id,
      status: { $in: ["pending", "active"] }
    });

    if (activeAssignments) {
      return res.status(400).json({ 
        error: "Cannot delete route with active or pending assignments" 
      });
    }

    const route = await Route.findByIdAndDelete(req.params.id);
    if (!route) {
      return res.status(404).json({ error: "Route not found" });
    }

    res.json({ ok: true, message: "Route deleted successfully" });
  } catch (err) {
    console.error("DELETE route error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ------------------ GET ROUTE STOPS ------------------ */
router.get("/:id/stops", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const route = await Route.findById(req.params.id).select("stops name").lean();
    
    if (!route) {
      return res.status(404).json({ error: "Route not found" });
    }

    res.json({ 
      ok: true, 
      routeName: route.name,
      stops: route.stops || [],
      totalStops: route.stops?.length || 0
    });
  } catch (err) {
    console.error("Get route stops error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ------------------ UPDATE STOP STATUS ------------------ */
router.patch("/:routeId/stops/:stopId", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const { routeId, stopId } = req.params;
    const { status, name, address, lat, lng } = req.body;

    const route = await Route.findById(routeId);
    if (!route) {
      return res.status(404).json({ error: "Route not found" });
    }

    const stopIndex = route.stops.findIndex(s => String(s._id) === stopId);
    if (stopIndex === -1) {
      return res.status(404).json({ error: "Stop not found" });
    }

    // Update stop fields
    if (status) route.stops[stopIndex].status = status;
    if (name) route.stops[stopIndex].name = name;
    if (address !== undefined) route.stops[stopIndex].address = address;
    if (lat !== undefined && lng !== undefined) {
      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ error: "Invalid coordinates" });
      }
      route.stops[stopIndex].lat = lat;
      route.stops[stopIndex].lng = lng;
    }
    
    route.stops[stopIndex].updatedAt = new Date();
    route.updatedBy = req.user.id;
    route.updatedAt = new Date();

    await route.save();

    res.json({ 
      ok: true, 
      stop: route.stops[stopIndex],
      message: "Stop updated successfully"
    });
  } catch (err) {
    console.error("Update stop error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ------------------ ADD STOP TO ROUTE ------------------ */
router.post("/:id/stops", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, lat, lng, order } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Stop name is required" });
    }

    const route = await Route.findById(id);
    if (!route) {
      return res.status(404).json({ error: "Route not found" });
    }

    const newStop = {
      _id: new mongoose.Types.ObjectId(),
      name,
      address: address || "",
      lat: lat || null,
      lng: lng || null,
      order: order !== undefined ? order : route.stops.length,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date()
    };

    route.stops.push(newStop);
    route.updatedBy = req.user.id;
    route.updatedAt = new Date();
    
    await route.save();

    res.status(201).json({ 
      ok: true, 
      stop: newStop,
      message: "Stop added successfully"
    });
  } catch (err) {
    console.error("Add stop error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ------------------ REMOVE STOP FROM ROUTE ------------------ */
router.delete("/:routeId/stops/:stopId", auth, requireRole("superadmin"), async (req, res) => {
  try {
    const { routeId, stopId } = req.params;

    const route = await Route.findById(routeId);
    if (!route) {
      return res.status(404).json({ error: "Route not found" });
    }

    const stopIndex = route.stops.findIndex(s => String(s._id) === stopId);
    if (stopIndex === -1) {
      return res.status(404).json({ error: "Stop not found" });
    }

    // Check if this stop is being used in any active assignments
    const { DailyAssignment } = await import("../models/DailyAssignment.js");
    const activeAssignment = await DailyAssignment.findOne({
      route: routeId,
      status: { $in: ["pending", "active"] },
      "stops._id": stopId
    });

    if (activeAssignment) {
      return res.status(400).json({ 
        error: "Cannot remove stop that is being used in active assignments" 
      });
    }

    route.stops.splice(stopIndex, 1);
    route.updatedBy = req.user.id;
    route.updatedAt = new Date();
    
    await route.save();

    res.json({ 
      ok: true, 
      message: "Stop removed successfully",
      remainingStops: route.stops.length
    });
  } catch (err) {
    console.error("Remove stop error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;