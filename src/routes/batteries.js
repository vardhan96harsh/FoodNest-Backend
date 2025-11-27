import express from "express";
import Battery from "../models/Battery.js";
import Vehicle from "../models/Vehicle.js";
import { auth } from "../middleware/auth.js";

const router = express.Router();

/* ---------------------------------------------------------
   CREATE BATTERY
--------------------------------------------------------- */
router.post("/", auth, async (req, res) => {
  try {
    const { imei, type, capacity, installationDate, status, vehicle } = req.body;

    // Validate vehicle exists
    const v = await Vehicle.findById(vehicle);
    if (!v) return res.status(404).json({ error: "Vehicle not found" });

    const battery = new Battery({
      imei,
      type,
      capacity,
      installationDate: new Date(installationDate),
      status,
      vehicle,
    });

    await battery.save();

    res.status(201).json(battery);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------------------------------------------------
   GET ALL BATTERIES
--------------------------------------------------------- */
router.get("/", auth, async (req, res) => {
  try {
    const batteries = await Battery.find().populate("vehicle");
    res.json(batteries);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------------------------------------------------
   UPDATE BATTERY
--------------------------------------------------------- */
router.put("/:id", auth, async (req, res) => {
  try {
    const updates = req.body;

    if (updates.installationDate)
      updates.installationDate = new Date(updates.installationDate);

    const updated = await Battery.findByIdAndUpdate(req.params.id, updates, {
      new: true,
    }).populate("vehicle");

    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------------------------------------------------------
   DELETE BATTERY
--------------------------------------------------------- */
router.delete("/:id", auth, async (req, res) => {
  try {
    await Battery.findByIdAndDelete(req.params.id);
    res.json({ message: "Battery deleted" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
