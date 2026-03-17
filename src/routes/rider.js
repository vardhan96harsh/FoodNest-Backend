import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { DailyAssignment } from "../models/DailyAssignment.js";
import { FoodItem } from "../models/FoodItem.js";
import { SalesTransaction } from "../models/SalesTransaction.js";

const router = express.Router();

/**
 * GET /api/rider/assignments/today
 * Get today's active assignment for the logged-in rider
 */
router.get("/assignments/today", auth, requireRole("rider"), async (req, res) => {
  try {
    const riderId = req.user.id;
    
    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Find active assignment for this rider today
    const assignment = await DailyAssignment.findOne({
      rider: riderId,
      date: { $gte: today, $lt: tomorrow },
      status: { $in: ["active", "pending"] }
    })
    .populate({
      path: "route",
      select: "name stops",
    })
    .populate("vehicle", "registrationNo type")
    .populate("battery", "imei charge health")
    .populate({
      path: "inventory.foodItem",
      select: "name price category imageUrl"
    })
    .lean();

    if (!assignment) {
      return res.json({ 
        ok: true, 
        assignment: null,
        message: "No active assignment found for today" 
      });
    }

    // Format the response
    const formattedAssignment = {
      _id: assignment._id,
      route: {
        _id: assignment.route._id,
        name: assignment.route.name,
        stops: assignment.stops || [] // Use stops from assignment, not from route
      },
      vehicle: assignment.vehicle,
      battery: assignment.battery,
      inventory: assignment.inventory.map(item => ({
        foodItem: item.foodItem,
        quantityAssigned: item.quantityAssigned,
        quantityRemaining: item.quantityRemaining,
        quantitySold: item.quantitySold
      })),
      startTime: assignment.startTime,
      endTime: assignment.endTime,
      status: assignment.status,
      date: assignment.date,
      createdAt: assignment.createdAt,
      currentLocation: assignment.currentLocation
    };

    res.json({
      ok: true,
      assignment: formattedAssignment
    });

  } catch (err) {
    console.error("Get rider assignment error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/rider/assignments/history
 * Get rider's past assignments
 */
router.get("/assignments/history", auth, requireRole("rider"), async (req, res) => {
  try {
    const riderId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const assignments = await DailyAssignment.find({
      rider: riderId,
      status: "completed"
    })
    .sort({ date: -1 })
    .skip(skip)
    .limit(limit)
    .populate("route", "name")
    .populate("vehicle", "registrationNo")
    .lean();

    const total = await DailyAssignment.countDocuments({
      rider: riderId,
      status: "completed"
    });

    // Calculate summary for each assignment
    const formattedAssignments = assignments.map(a => ({
      _id: a._id,
      date: a.date,
      routeName: a.route?.name,
      vehicleReg: a.vehicle?.registrationNo,
      totalItems: a.inventory.reduce((sum, i) => sum + i.quantityAssigned, 0),
      totalSold: a.inventory.reduce((sum, i) => sum + i.quantitySold, 0),
      totalRevenue: a.inventory.reduce((sum, i) => sum + (i.quantitySold * i.price), 0),
      startTime: a.startTime,
      endTime: a.endTime,
      stopsCompleted: a.stops?.filter(s => s.status === 'completed').length || 0,
      totalStops: a.stops?.length || 0
    }));

    res.json({
      ok: true,
      assignments: formattedAssignments,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (err) {
    console.error("Get assignment history error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/rider/assignments/:id
 * Get specific assignment details
 */
router.get("/assignments/:id", auth, requireRole("rider"), async (req, res) => {
  try {
    const assignmentId = req.params.id;
    const riderId = req.user.id;

    const assignment = await DailyAssignment.findOne({
      _id: assignmentId,
      rider: riderId
    })
    .populate({
      path: "route",
      select: "name"
    })
    .populate("vehicle", "registrationNo type")
    .populate("battery", "imei charge health")
    .populate({
      path: "inventory.foodItem",
      select: "name price category imageUrl"
    })
    .lean();

    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    // Get sales transactions for this assignment
    const sales = await SalesTransaction.find({ assignment: assignmentId })
      .populate("foodItem", "name price")
      .sort({ createdAt: -1 });

    res.json({
      ok: true,
      assignment: {
        ...assignment,
        sales
      }
    });

  } catch (err) {
    console.error("Get assignment details error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/rider/assignments/:id/start
 * Start the assignment (when rider begins route)
 */
router.post("/assignments/:id/start", auth, requireRole("rider"), async (req, res) => {
  try {
    const assignment = await DailyAssignment.findById(req.params.id);

    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    // Ensure the assigned rider is starting the assignment
    if (String(assignment.rider) !== req.user.id) {
      return res.status(403).json({ error: "Not your assignment" });
    }

    // Check if already started
    if (assignment.startTime) {
      return res.status(400).json({ error: "Assignment already started" });
    }

    // Start the assignment
    assignment.startTime = new Date();
    assignment.status = "active";
    
    // Initialize first stop if exists
    if (assignment.stops && assignment.stops.length > 0) {
      assignment.stops[0].status = "in-progress";
    }
    
    await assignment.save();

    res.json({ 
      ok: true, 
      message: "Assignment started successfully",
      startTime: assignment.startTime 
    });
  } catch (err) {
    console.error("Start assignment error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/rider/sales
 * Rider records a sale (updated to include stop information)
 */
router.post("/sales", auth, requireRole("rider"), async (req, res) => {
  try {
    const { assignmentId, foodItemId, qty, stopId } = req.body;

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

    // If stopId is provided, update stop sales
    if (stopId) {
      const stop = assignment.stops.find(s => String(s._id) === stopId);
      if (stop) {
        if (!stop.sales) {
          stop.sales = {
            items: [],
            totalRevenue: 0,
            totalItems: 0
          };
        }

        // Add to stop sales
        const existingSaleIndex = stop.sales.items.findIndex(
          s => String(s.foodItemId) === String(foodItemId)
        );

        const food = await FoodItem.findById(foodItemId);
        
        if (existingSaleIndex >= 0) {
          stop.sales.items[existingSaleIndex].quantity += qty;
        } else {
          stop.sales.items.push({
            foodItemId,
            name: food.name,
            quantity: qty,
            price: food.price
          });
        }

        stop.sales.totalRevenue += food.price * qty;
        stop.sales.totalItems += qty;
      }
    }

    // Save the updated inventory
    await DailyAssignment.updateOne(
      { _id: assignmentId },
      { 
        $set: { 
          "inventory": assignment.inventory,
          "stops": assignment.stops
        }
      }
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
      total,
      stopId: stopId || null
    });

    await sale.save();

    // Update total sales for the assignment
    assignment.totalSales = (assignment.totalSales || 0) + total;
    await assignment.save();

    res.json({
      ok: true,
      saleId: sale._id,
      total,
      updatedInventory: {
        foodItemId,
        quantityRemaining: item.quantityRemaining,
        quantitySold: item.quantitySold
      }
    });

  } catch (err) {
    console.error("Sales error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/rider/stops/:stopId/arrive
 * Mark arrival at a stop
 */
router.post("/stops/:stopId/arrive", auth, requireRole("rider"), async (req, res) => {
  try {
    const { stopId } = req.params;
    const { assignmentId } = req.body;

    const assignment = await DailyAssignment.findOne({
      _id: assignmentId,
      rider: req.user.id
    });

    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    const stopIndex = assignment.stops.findIndex(s => String(s._id) === stopId);
    if (stopIndex === -1) {
      return res.status(404).json({ error: "Stop not found" });
    }

    // Update previous stop if needed
    if (stopIndex > 0) {
      const previousStop = assignment.stops[stopIndex - 1];
      if (previousStop.status === "in-progress") {
        previousStop.status = "completed";
        previousStop.completedAt = new Date();
        if (previousStop.arrivedAt) {
          previousStop.durationMinutes = Math.round(
            (previousStop.completedAt - previousStop.arrivedAt) / 60000
          );
        }
      }
    }

    // Mark current stop as arrived
    assignment.stops[stopIndex].status = "in-progress";
    assignment.stops[stopIndex].arrivedAt = new Date();

    await assignment.save();

    res.json({ 
      ok: true,
      stop: assignment.stops[stopIndex]
    });

  } catch (err) {
    console.error("Stop arrival error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/rider/stops/:stopId/complete
 * Mark stop as complete (updated version)
 */
router.post("/stops/:stopId/complete", auth, requireRole("rider"), async (req, res) => {
  try {
    const { stopId } = req.params;
    const { assignmentId } = req.body;

    const assignment = await DailyAssignment.findOne({
      _id: assignmentId,
      rider: req.user.id
    });

    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    const stopIndex = assignment.stops.findIndex(s => String(s._id) === stopId);
    if (stopIndex === -1) {
      return res.status(404).json({ error: "Stop not found" });
    }

    const stop = assignment.stops[stopIndex];
    stop.status = "completed";
    stop.completedAt = new Date();

    if (stop.arrivedAt) {
      stop.durationMinutes = Math.round((stop.completedAt - stop.arrivedAt) / 60000);
    }

    // Check if this was the last stop
    const allStopsCompleted = assignment.stops.every(s => s.status === "completed");
    if (allStopsCompleted) {
      assignment.status = "completed";
      assignment.endTime = new Date();
    } else {
      // Auto-start next stop if it exists
      const nextStop = assignment.stops[stopIndex + 1];
      if (nextStop && nextStop.status === "pending") {
        nextStop.status = "in-progress";
      }
    }

    await assignment.save();

    res.json({ 
      ok: true,
      stop,
      allStopsCompleted,
      nextStop: assignment.stops[stopIndex + 1] || null
    });

  } catch (err) {
    console.error("Complete stop error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/rider/location
 * Update location in real-time
 */
router.post("/location", auth, requireRole("rider"), async (req, res) => {
  try {
    const { assignmentId, lat, lng } = req.body;
    
    if (!assignmentId || !lat || !lng) {
      return res.status(400).json({ error: "Missing assignmentId, lat, or lng" });
    }

    const assignment = await DailyAssignment.findOne({
      _id: assignmentId,
      rider: req.user.id
    });

    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    assignment.currentLocation = { 
      lat, 
      lng, 
      updatedAt: new Date() 
    };

    await assignment.save();

    res.json({ ok: true });
  } catch (err) {
    console.error("Location update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/rider/stats/today
 * Get today's stats for the rider
 */
router.get("/stats/today", auth, requireRole("rider"), async (req, res) => {
  try {
    const riderId = req.user.id;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const assignment = await DailyAssignment.findOne({
      rider: riderId,
      date: { $gte: today, $lt: tomorrow }
    });

    if (!assignment) {
      return res.json({
        ok: true,
        stats: {
          hasAssignment: false,
          totalSales: 0,
          totalItemsSold: 0,
          stopsCompleted: 0,
          totalStops: 0
        }
      });
    }

    const totalItemsSold = assignment.inventory.reduce((sum, i) => sum + i.quantitySold, 0);
    const totalSales = assignment.inventory.reduce(
      (sum, i) => sum + (i.quantitySold * i.price), 0
    );
    const stopsCompleted = assignment.stops?.filter(s => s.status === 'completed').length || 0;

    res.json({
      ok: true,
      stats: {
        hasAssignment: true,
        totalSales,
        totalItemsSold,
        stopsCompleted,
        totalStops: assignment.stops?.length || 0,
        status: assignment.status,
        startTime: assignment.startTime
      }
    });

  } catch (err) {
    console.error("Get rider stats error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;