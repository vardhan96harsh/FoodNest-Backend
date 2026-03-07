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
    const finalVehicle =
      vehicleId && vehicleId.trim() !== "" ? vehicleId :
      vehicle && vehicle.trim() !== "" ? vehicle :
      null;

    // If vehicle is provided, check if it exists
    if (finalVehicle) {
      const exists = await Vehicle.findById(finalVehicle);
      if (!exists)
        return res.status(404).json({ error: "Vehicle not found" });
      
      // 🔴 NEW CODE: Check if vehicle already has a battery
      const vehicleWithBattery = await Vehicle.findOne({
        _id: finalVehicle,
        battery: { $ne: null }  // Check if battery field is NOT null
      });
      
      if (vehicleWithBattery) {
        return res.status(400).json({ 
          error: "Vehicle already has a battery assigned. Remove existing battery first." 
        });
      }
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
      
      // 🔴 NEW CODE: Check if vehicle already has a DIFFERENT battery
      const vehicleWithBattery = await Vehicle.findOne({
        _id: finalVehicle,
        battery: { $ne: null, $ne: req.params.id }  // Check if it has a battery that's NOT this one
      });
      
      if (vehicleWithBattery) {
        return res.status(400).json({ 
          error: "Vehicle already has a different battery assigned." 
        });
      }
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
/* ---------------------------------------------------------
   DELETE BATTERY
--------------------------------------------------------- */
router.delete("/:id", auth, async (req, res) => {
  try {
    const battery = await Battery.findById(req.params.id);
    
    if (!battery) {
      return res.status(404).json({ error: "Battery not found" });
    }
    
    // 🔴 FIX: If this battery was assigned to a vehicle, remove the reference
    if (battery.vehicle) {
      await Vehicle.findByIdAndUpdate(battery.vehicle, {
        $set: { battery: null }
      });
    }
    
    await Battery.findByIdAndDelete(req.params.id);
    res.json({ message: "Battery deleted successfully" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
export default router;
