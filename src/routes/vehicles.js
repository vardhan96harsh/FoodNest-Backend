import express from "express";
import Vehicle from "../models/Vehicle.js";
import Battery from "../models/Battery.js";
import { auth } from "../middleware/auth.js";

const router = express.Router();

/* ---------------------------------------------------------
   CREATE VEHICLE
--------------------------------------------------------- */
router.post("/", auth, async (req, res) => {
  try {
    const vehicle = new Vehicle(req.body);
    await vehicle.save();
    res.status(201).json(vehicle);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------------------------------------------------
   GET ALL VEHICLES (WITH BATTERY)
--------------------------------------------------------- */
router.get("/", auth, async (req, res) => {
  try {
    const vehicles = await Vehicle.find()
      .populate("battery")
      .sort({ createdAt: -1 });

    res.json(vehicles);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------------------------------------------------
   GET ONE VEHICLE BY ID (WITH BATTERY)
--------------------------------------------------------- */
router.get("/:id", auth, async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id).populate("battery");

    if (!vehicle)
      return res.status(404).json({ error: "Vehicle not found" });

    res.json(vehicle);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------------------------------------------------
   UPDATE VEHICLE (MAIN FIELDS ONLY)
--------------------------------------------------------- */
router.put("/:id", auth, async (req, res) => {
  try {
    const updated = await Vehicle.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    ).populate("battery");

    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------------------------------------------------
   DELETE VEHICLE
--------------------------------------------------------- */
router.delete("/:id", auth, async (req, res) => {
  try {
    await Vehicle.findByIdAndDelete(req.params.id);
    res.json({ message: "Vehicle deleted" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------------------------------------------------
   ADD SERVICE RECORD (PUSH)
--------------------------------------------------------- */
router.post("/:id/service-records", auth, async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);

    if (!vehicle)
      return res.status(404).json({ error: "Vehicle not found" });

    vehicle.serviceRecords.push(req.body);
    await vehicle.save();

    res.json(vehicle);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------------------------------------------------
   DELETE SERVICE RECORD BY INDEX
--------------------------------------------------------- */
router.delete("/:id/service-records/:index", auth, async (req, res) => {
  try {
    const { id, index } = req.params;

    const vehicle = await Vehicle.findById(id);

    if (!vehicle)
      return res.status(404).json({ error: "Vehicle not found" });

    if (!vehicle.serviceRecords[index])
      return res.status(400).json({ error: "Invalid index" });

    vehicle.serviceRecords.splice(index, 1);
    await vehicle.save();

    res.json(vehicle);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------------------------------------------------
   EDIT SERVICE RECORD BY INDEX
--------------------------------------------------------- */
router.put("/:id/service-records/:index", auth, async (req, res) => {
  try {
    const { id, index } = req.params;
    const updates = req.body;

    const vehicle = await Vehicle.findById(id);

    if (!vehicle)
      return res.status(404).json({ error: "Vehicle not found" });

    if (!vehicle.serviceRecords[index])
      return res.status(400).json({ error: "Invalid service record index" });

    // Perform update
    vehicle.serviceRecords[index] = {
      ...vehicle.serviceRecords[index]._doc,
      ...updates,
    };

    await vehicle.save();

    res.json(vehicle);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


export default router;
