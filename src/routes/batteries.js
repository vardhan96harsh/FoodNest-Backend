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
    let { vehicleId, vehicle, ...body } = req.body;

    // Allow frontend to send vehicleId or vehicle or null
    const finalVehicle = vehicleId || vehicle || null;

    // If vehicle is provided, check if it exists
    if (finalVehicle) {
      const exists = await Vehicle.findById(finalVehicle);
      if (!exists)
        return res.status(404).json({ error: "Vehicle not found" });
    }

    const battery = new Battery({
      ...body,
      vehicle: finalVehicle, // can be null
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
    let { vehicleId, vehicle, ...body } = req.body;

    const finalVehicle = vehicleId || vehicle || null;

    // If vehicle is provided, check if exists
    if (finalVehicle) {
      const exists = await Vehicle.findById(finalVehicle);
      if (!exists)
        return res.status(404).json({ error: "Vehicle not found" });
    }

    const updated = await Battery.findByIdAndUpdate(
      req.params.id,
      { ...body, vehicle: finalVehicle },
      { new: true }
    );

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
