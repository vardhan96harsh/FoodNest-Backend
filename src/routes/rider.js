import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { DailyAssignment } from "../models/DailyAssignment.js";
import { FoodItem } from "../models/FoodItem.js";
import { SalesTransaction } from "../models/SalesTransaction.js";

const router = express.Router();

/**
 * POST /api/rider/sales
 * Rider records a sale
 */
router.post("/sales", auth, requireRole("rider"), async (req, res) => {
  try {
    const { assignmentId, foodItemId, qty } = req.body;

    // Find the assignment
    const assignment = await DailyAssignment.findById(assignmentId);
    if (!assignment) return res.status(404).json({ error: "Assignment not found" });

    // Find the food item in the assignment's inventory
    const item = assignment.inventory.find(i => String(i.foodItem) === String(foodItemId));
    if (!item) return res.status(400).json({ error: "Food item not assigned to this assignment" });

    // Check if there's enough stock
    if (item.quantityRemaining < qty) {
      return res.status(400).json({ error: "Not enough stock for the requested sale" });
    }

    // Update inventory
    item.quantitySold += qty;
    item.quantityRemaining -= qty;

    // Save the updated inventory
    await DailyAssignment.updateOne(
      { _id: assignmentId },
      { $set: { "inventory.$[i]": item } },
      { arrayFilters: [{ "i.foodItem": foodItemId }] }
    );

    // Fetch food item details to calculate the total price
    const food = await FoodItem.findById(foodItemId);
    if (!food) return res.status(404).json({ error: "Food item not found" });

    const total = food.price * qty;

    // Record the sale
    const sale = new SalesTransaction({
      assignment: assignmentId,
      rider: req.user.id,
      foodItem: foodItemId,
      quantity: qty,
      price: food.price,
      total
    });

    await sale.save();

    // Update total sales for the assignment
    assignment.totalSales = (assignment.totalSales || 0) + total;
    await assignment.save();

    res.json({
      ok: true,
      saleId: sale._id,
      total
    });

  } catch (err) {
    console.error("Sales error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/assignments/:id/start", auth, requireRole("rider"), async (req, res) => {
  try {
    const assignment = await DailyAssignment.findById(req.params.id);

    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    // Ensure the assignment is not already active
    if (assignment.status === 'active') {
      return res.status(400).json({ error: "Assignment already started" });
    }

    // Ensure the assigned rider is starting the assignment
    if (String(assignment.rider) !== req.user.id) {
      return res.status(403).json({ error: "Not your assignment" });
    }

    // Start the assignment
    assignment.startTime = new Date();
    assignment.status = "active";
    await assignment.save();

    res.json({ ok: true, assignment });
  } catch (err) {
    console.error("Start assignment error:", err);
    res.status(500).json({ error: "Server error" });
  }
});
/**
 * POST /api/rider/location
 * Update location in real-time
 */
router.post("/location", auth, requireRole("rider"), async (req, res) => {
  try {
    // Ensure the body contains the necessary properties
    const { assignmentId, lat, lng } = req.body;
    
    if (!assignmentId || !lat || !lng) {
      return res.status(400).json({ error: "Missing assignmentId, lat, or lng" });
    }

    // Find the assignment
    const assignment = await DailyAssignment.findById(assignmentId);
    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    // Update the assignment's current location
    assignment.currentLocation = { lat, lng, updatedAt: new Date() };

    await assignment.save();

    res.json({ ok: true });
  } catch (err) {
    console.error("Location update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});



// Start stop
router.post("/stops/:assignmentId/:index/start", auth, requireRole("rider"), async (req, res) => {
  const { assignmentId, index } = req.params;

  const assignment = await DailyAssignment.findById(assignmentId);
  if (!assignment) return res.status(404).json({ error: "Assignment not found" });

  const stop = assignment.stops[index];
  if (!stop) return res.status(404).json({ error: "Stop not found" });

  stop.status = "in-progress";
  stop.arrivedAt = new Date();

  await assignment.save();
  res.json({ ok: true });
});

// Complete stop and track duration
router.post("/stops/:assignmentId/:index/complete", auth, requireRole("rider"), async (req, res) => {
  const { assignmentId, index } = req.params;

  const assignment = await DailyAssignment.findById(assignmentId);
  if (!assignment) return res.status(404).json({ error: "Assignment not found" });

  const stop = assignment.stops[index];
  if (!stop) return res.status(404).json({ error: "Stop not found" });

  stop.status = "completed";
  stop.completedAt = new Date();

  const duration = (stop.completedAt - stop.arrivedAt) / 60000;
  stop.durationMinutes = Math.round(duration);

  await assignment.save();
  res.json({ ok: true });
});


export default router;