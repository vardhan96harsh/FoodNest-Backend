import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { DailyAssignment } from "../models/DailyAssignment.js";
import { FoodItem } from "../models/FoodItem.js";
import { SalesTransaction } from "../models/SalesTransaction.js";
import mongoose from "mongoose";

const router = express.Router();

/**
 * POST /api/rider/assignments/:id/accept
 * Rider accepts the assignment
 */
router.post("/assignments/:id/accept", auth, requireRole("rider"), async (req, res) => {
  try {
    const assignmentId = req.params.id;
    const riderId = req.user.id;

    const assignment = await DailyAssignment.findOne({
      _id: assignmentId,
      rider: riderId
    });

    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    if (assignment.status !== "pending") {
      return res.status(400).json({ 
        error: `Cannot accept assignment in ${assignment.status} status. Assignment must be pending.` 
      });
    }

    assignment.status = "active";
    await assignment.save();

    res.json({ 
      ok: true, 
      message: "Assignment accepted successfully",
      assignment: {
        _id: assignment._id,
        status: assignment.status,
        route: assignment.route,
        stops: assignment.stops,
        inventory: assignment.inventory
      }
    });

  } catch (err) {
    console.error("Accept assignment error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/rider/assignments/today
 * Get today's active assignment for the logged-in rider
 */
router.get("/assignments/today", auth, requireRole("rider"), async (req, res) => {
  try {
    const riderId = req.user.id;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const assignment = await DailyAssignment.findOne({
      rider: riderId,
      date: { $gte: today, $lt: tomorrow },
      status: { $in: ["pending", "active"] }
    })
    .populate({
      path: "route",
      select: "name",
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
        message: "No assignment found for today" 
      });
    }

    const formattedStops = (assignment.stops || []).map(stop => ({
      _id: stop._id,
      stopName: stop.stopName || "Unnamed Stop",
      address: stop.address || "",
      status: stop.status || "pending",
      arrivedAt: stop.arrivedAt,
      completedAt: stop.completedAt,
      durationMinutes: stop.durationMinutes || 0,
      sales: stop.sales || { items: [], totalRevenue: 0, totalItems: 0 }
    }));

    const formattedAssignment = {
      _id: assignment._id,
      route: {
        _id: assignment.route?._id,
        name: assignment.route?.name || "Unknown Route"
      },
      stops: formattedStops,
      vehicle: assignment.vehicle,
      battery: assignment.battery,
      inventory: (assignment.inventory || []).map(item => ({
        foodItem: item.foodItem,
        quantityAssigned: item.quantityAssigned || 0,
        quantityRemaining: item.quantityRemaining || 0,
        quantitySold: item.quantitySold || 0
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
 * Get rider's past assignments with detailed analytics
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
    .populate({
      path: "inventory.foodItem",
      select: "price"
    })
    .lean();

    const total = await DailyAssignment.countDocuments({
      rider: riderId,
      status: "completed"
    });

    const formattedAssignments = assignments.map(a => ({
      _id: a._id,
      date: a.date,
      routeName: a.route?.name,
      vehicleReg: a.vehicle?.registrationNo,
      totalItems: a.inventory?.reduce((sum, i) => sum + (i.quantityAssigned || 0), 0) || 0,
      totalSold: a.inventory?.reduce((sum, i) => sum + (i.quantitySold || 0), 0) || 0,
      totalRevenue: a.inventory?.reduce((sum, i) => {
        const price = i.foodItem?.price || 0;
        return sum + ((i.quantitySold || 0) * price);
      }, 0) || 0,
      startTime: a.startTime,
      endTime: a.endTime,
      duration: a.startTime && a.endTime ? Math.round((a.endTime - a.startTime) / 60000) : 0,
      stopsCompleted: a.stops?.filter(s => s.status === 'completed').length || 0,
      totalStops: a.stops?.length || 0,
      stopsBreakdown: a.stops?.map(s => ({
        name: s.stopName,
        duration: s.durationMinutes,
        sales: s.sales?.totalItems || 0,
        revenue: s.sales?.totalRevenue || 0
      })) || []
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
 * Get specific assignment details with full analytics
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

    const sales = await SalesTransaction.find({ assignment: assignmentId })
      .populate("foodItem", "name price")
      .sort({ createdAt: -1 });

    // Calculate time-based analytics
    const stopsWithTiming = (assignment.stops || []).map(stop => ({
      ...stop,
      waitTime: stop.arrivedAt && stop.completedAt ? 
        Math.round((stop.completedAt - stop.arrivedAt) / 60000) : 0
    }));

    const totalDuration = assignment.startTime && assignment.endTime ? 
      Math.round((assignment.endTime - assignment.startTime) / 60000) : 0;

    res.json({
      ok: true,
      assignment: {
        ...assignment,
        stops: stopsWithTiming,
        sales,
        analytics: {
          totalDuration,
          averageStopDuration: stopsWithTiming.length > 0 ? 
            totalDuration / stopsWithTiming.length : 0,
          revenuePerStop: stopsWithTiming.length > 0 ? 
            (assignment.totalSales || 0) / stopsWithTiming.length : 0,
          itemsPerStop: stopsWithTiming.length > 0 ? 
            (assignment.totalItemsSold || 0) / stopsWithTiming.length : 0
        }
      }
    });

  } catch (err) {
    console.error("Get assignment details error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/rider/assignments/:id/start
 * Start the assignment - DOES NOT auto-mark first stop
 */
router.post("/assignments/:id/start", auth, requireRole("rider"), async (req, res) => {
  try {
    const assignment = await DailyAssignment.findById(req.params.id);

    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    if (String(assignment.rider) !== req.user.id) {
      return res.status(403).json({ error: "Not your assignment" });
    }

    if (assignment.startTime) {
      return res.status(400).json({ error: "Assignment already started" });
    }

    if (assignment.status !== "active") {
      return res.status(400).json({ 
        error: `Cannot start assignment in ${assignment.status} status. Assignment must be accepted first.` 
      });
    }

    // Check if there are stops
    if (!assignment.stops || assignment.stops.length === 0) {
      return res.status(400).json({ error: "No stops found for this assignment" });
    }

    // Start the assignment - DO NOT auto-mark first stop
    assignment.startTime = new Date();
    
    // REMOVED: Auto-marking first stop as in-progress
    // Rider must manually click "Arrive" for each stop including first
    
    await assignment.save();

    res.json({ 
      ok: true, 
      message: "Assignment started successfully. You can now arrive at stops manually.",
      startTime: assignment.startTime,
      totalStops: assignment.stops.length
    });
  } catch (err) {
    console.error("Start assignment error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

/**
 * POST /api/rider/sales
 * Rider records a sale (no location required)
 */
router.post("/sales", auth, requireRole("rider"), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { assignmentId, foodItemId, qty, stopId } = req.body;
    const riderId = req.user.id;

    console.log(`[Sales] Assignment: ${assignmentId}, Rider: ${riderId}, Food: ${foodItemId}, Qty: ${qty}`);

    // Validate input
    if (!assignmentId || !foodItemId || !qty || !stopId) {
      await session.abortTransaction();
      return res.status(400).json({ 
        error: "Missing required fields: assignmentId, foodItemId, qty, stopId" 
      });
    }

    if (qty <= 0) {
      await session.abortTransaction();
      return res.status(400).json({ error: "Quantity must be greater than 0" });
    }

    // Find assignment and verify it belongs to the rider
    const assignment = await DailyAssignment.findOne({
      _id: assignmentId,
      rider: riderId
    })
    .populate({
      path: "inventory.foodItem",
      select: "name price"
    })
    .session(session);

    if (!assignment) {
      await session.abortTransaction();
      return res.status(404).json({ error: "Assignment not found or not authorized" });
    }

    console.log(`[Sales] Assignment found: ${assignment._id}, Status: ${assignment.status}`);

    // Check if assignment is active
    if (assignment.status !== "active") {
      await session.abortTransaction();
      return res.status(400).json({ 
        error: `Cannot record sales. Assignment status is ${assignment.status}, must be active` 
      });
    }

    // Validate stop
    const stop = assignment.stops.find(s => String(s._id) === stopId);
    if (!stop) {
      await session.abortTransaction();
      return res.status(404).json({ error: "Stop not found" });
    }
    
    if (stop.status !== "in-progress") {
      await session.abortTransaction();
      return res.status(400).json({ 
        error: `Cannot record sales. Stop status is ${stop.status}, must be in-progress` 
      });
    }

    // Find the inventory item
    const item = assignment.inventory.find(i => String(i.foodItem._id) === String(foodItemId));
    if (!item) {
      await session.abortTransaction();
      return res.status(404).json({ error: "Food item not assigned to this assignment" });
    }

    console.log(`[Sales] Item found: ${item.foodItem?.name || 'Unknown'}, Remaining: ${item.quantityRemaining}`);

    if (item.quantityRemaining < qty) {
      await session.abortTransaction();
      return res.status(400).json({ 
        error: `Not enough stock. Only ${item.quantityRemaining} remaining` 
      });
    }

    // Update inventory
    item.quantitySold += qty;
    item.quantityRemaining -= qty;

    // Update stop sales
    if (!stop.sales) {
      stop.sales = {
        items: [],
        totalRevenue: 0,
        totalItems: 0
      };
    }

    const food = item.foodItem;
    if (!food) {
      await session.abortTransaction();
      return res.status(404).json({ error: "Food item not found" });
    }
    
    const existingSaleIndex = stop.sales.items.findIndex(
      s => String(s.foodItemId) === String(foodItemId)
    );
    
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

    const total = food.price * qty;

    // Record the sale - NO LOCATION REQUIRED
    const sale = new SalesTransaction({
      assignment: assignmentId,
      rider: riderId,
      foodItem: foodItemId,
      stopId: stopId,
      stopName: stop.stopName,
      quantity: qty,
      price: food.price,
      total,
      soldAt: new Date()
    });

    await sale.save({ session });

    assignment.totalSales = (assignment.totalSales || 0) + total;
    assignment.totalItemsSold = (assignment.totalItemsSold || 0) + qty;
    
    await assignment.save({ session });
    await session.commitTransaction();

    console.log(`[Sales] Sale recorded successfully. Total: ${total}`);

    res.json({
      ok: true,
      message: "Sale recorded successfully",
      saleId: sale._id,
      total,
      timestamp: sale.soldAt,
      updatedInventory: {
        foodItemId,
        quantityRemaining: item.quantityRemaining,
        quantitySold: item.quantitySold
      },
      stopSales: stop.sales
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("Sales error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  } finally {
    session.endSession();
  }
});

/**
 * POST /api/rider/stops/:stopId/arrive
 * Mark arrival at a stop (manual, no location required)
 */
router.post("/stops/:stopId/arrive", auth, requireRole("rider"), async (req, res) => {
  const { stopId } = req.params;
  const { assignmentId } = req.body;

  // Validate assignmentId
  if (!assignmentId) {
    return res.status(400).json({ error: "assignmentId is required" });
  }

  try {
    const assignment = await DailyAssignment.findOne({
      _id: assignmentId,
      rider: req.user.id
    });

    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    if (!assignment.stops || assignment.stops.length === 0) {
      return res.status(400).json({ error: "No stops found in this assignment" });
    }

    // Check if assignment has started
    if (!assignment.startTime) {
      return res.status(400).json({ error: "Assignment has not been started yet. Please start the assignment first." });
    }

    // Find the stop
    const stopIndex = assignment.stops.findIndex(s => String(s._id) === stopId);
    if (stopIndex === -1) {
      return res.status(404).json({ error: "Stop not found" });
    }

    const stop = assignment.stops[stopIndex];

    // Check current status
    if (stop.status === "completed") {
      return res.status(400).json({ error: "Stop is already completed" });
    }

    if (stop.status === "in-progress") {
      return res.status(400).json({ error: "Stop is already in progress" });
    }

    // Check if this is the correct stop order
    // Find the first non-completed stop
    const firstNonCompletedIndex = assignment.stops.findIndex(s => s.status !== "completed");
    if (firstNonCompletedIndex !== stopIndex) {
      const nextStop = assignment.stops[firstNonCompletedIndex];
      return res.status(400).json({ 
        error: `Please complete stops in order. Next stop to visit: ${nextStop?.stopName || "Unknown"}`,
        nextStopId: nextStop?._id,
        nextStopName: nextStop?.stopName
      });
    }

    // Mark stop as arrived/in-progress
    stop.status = "in-progress";
    stop.arrivedAt = new Date();

    await assignment.save();

    res.json({ 
      ok: true, 
      message: `Arrived at ${stop.stopName} successfully`,
      stop: {
        _id: stop._id,
        stopName: stop.stopName,
        address: stop.address,
        status: stop.status,
        arrivedAt: stop.arrivedAt,
        stopNumber: stopIndex + 1,
        totalStops: assignment.stops.length
      }
    });
  } catch (err) {
    console.error("Error marking stop arrival:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

/**
 * POST /api/rider/stops/:stopId/complete
 * Mark stop as complete (manual, no location required)
 */
router.post("/stops/:stopId/complete", auth, requireRole("rider"), async (req, res) => {
  const { stopId } = req.params;
  const { assignmentId } = req.body;

  // Validate assignmentId
  if (!assignmentId) {
    return res.status(400).json({ error: "assignmentId is required" });
  }

  try {
    const assignment = await DailyAssignment.findOne({
      _id: assignmentId,
      rider: req.user.id
    });

    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    if (!assignment.stops || assignment.stops.length === 0) {
      return res.status(400).json({ error: "No stops found in this assignment" });
    }

    // Find the stop
    const stopIndex = assignment.stops.findIndex(s => String(s._id) === stopId);
    if (stopIndex === -1) {
      return res.status(404).json({ error: "Stop not found" });
    }

    const stop = assignment.stops[stopIndex];

    // Check if stop is in progress
    if (stop.status !== "in-progress") {
      return res.status(400).json({ 
        error: `Cannot complete stop. Current status: ${stop.status}. Stop must be 'in-progress' first.`,
        currentStatus: stop.status
      });
    }

    // Mark stop as completed
    stop.status = "completed";
    stop.completedAt = new Date();

    // Calculate duration if arrivedAt exists
    if (stop.arrivedAt) {
      const durationMs = stop.completedAt - stop.arrivedAt;
      stop.durationMinutes = Math.round(durationMs / 60000); // Convert to minutes
    }

    // Check if all stops are completed
    const allStopsCompleted = assignment.stops.every(s => s.status === "completed");

    // If all stops completed, mark assignment as completed
    if (allStopsCompleted) {
      assignment.status = "completed";
      assignment.endTime = new Date();
    }

    await assignment.save();

    // Prepare response with next stop info if available
    const nextStopIndex = stopIndex + 1;
    const hasNextStop = nextStopIndex < assignment.stops.length;
    const nextStop = hasNextStop ? assignment.stops[nextStopIndex] : null;

    res.json({ 
      ok: true, 
      message: `Stop "${stop.stopName}" completed successfully`,
      stop: {
        _id: stop._id,
        stopName: stop.stopName,
        status: stop.status,
        arrivedAt: stop.arrivedAt,
        completedAt: stop.completedAt,
        durationMinutes: stop.durationMinutes,
        stopNumber: stopIndex + 1,
        totalStops: assignment.stops.length
      },
      allStopsCompleted: allStopsCompleted,
      assignmentStatus: assignment.status,
      nextStop: nextStop ? {
        _id: nextStop._id,
        stopName: nextStop.stopName,
        address: nextStop.address,
        stopNumber: nextStopIndex + 1
      } : null
    });
  } catch (err) {
    console.error("Error completing stop:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

/**
 * GET /api/rider/current-assignment
 * Get current active assignment with full details
 */
router.get("/current-assignment", auth, requireRole("rider"), async (req, res) => {
  try {
    const riderId = req.user.id;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const assignment = await DailyAssignment.findOne({
      rider: riderId,
      date: { $gte: today, $lt: tomorrow },
      status: { $in: ["pending", "active"] }
    })
    .populate("route", "name")
    .populate("vehicle", "registrationNo type")
    .populate("battery", "imei charge health")
    .populate({
      path: "inventory.foodItem",
      select: "name price category imageUrl"
    });

    if (!assignment) {
      return res.json({
        ok: true,
        hasActiveAssignment: false,
        assignment: null,
        message: "No active assignment found for today"
      });
    }

    // Get current stop info
    const currentStopIndex = assignment.stops?.findIndex(s => s.status === "in-progress");
    const currentStop = currentStopIndex >= 0 ? assignment.stops[currentStopIndex] : null;
    
    // Get next stop (first pending stop after current)
    const nextStopIndex = currentStopIndex >= 0 
      ? assignment.stops.findIndex((s, idx) => idx > currentStopIndex && s.status === "pending")
      : assignment.stops?.findIndex(s => s.status === "pending");
    const nextStop = nextStopIndex >= 0 ? assignment.stops[nextStopIndex] : null;

    // Calculate progress
    const stopsCompleted = assignment.stops?.filter(s => s.status === "completed").length || 0;
    const totalStops = assignment.stops?.length || 0;
    const progress = totalStops > 0 ? (stopsCompleted / totalStops) * 100 : 0;

    res.json({
      ok: true,
      hasActiveAssignment: true,
      assignment: {
        _id: assignment._id,
        routeName: assignment.route?.name,
        vehicle: assignment.vehicle,
        battery: assignment.battery,
        status: assignment.status,
        startTime: assignment.startTime,
        currentStop: currentStop ? {
          _id: currentStop._id,
          stopName: currentStop.stopName,
          address: currentStop.address,
          status: currentStop.status,
          arrivedAt: currentStop.arrivedAt,
          sales: currentStop.sales,
          stopNumber: currentStopIndex + 1
        } : null,
        nextStop: nextStop ? {
          _id: nextStop._id,
          stopName: nextStop.stopName,
          address: nextStop.address,
          stopNumber: nextStopIndex + 1
        } : null,
        stopsCompleted: stopsCompleted,
        totalStops: totalStops,
        progress: Math.round(progress),
        inventory: assignment.inventory.map(item => ({
          foodItem: item.foodItem,
          quantityAssigned: item.quantityAssigned,
          quantityRemaining: item.quantityRemaining,
          quantitySold: item.quantitySold
        })),
        totalSales: assignment.totalSales || 0,
        totalItemsSold: assignment.totalItemsSold || 0
      }
    });

  } catch (err) {
    console.error("Get current assignment error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/rider/stats/today
 * Get today's stats for the rider with detailed analytics
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
    })
    .populate({
      path: "inventory.foodItem",
      select: "name price"
    });

    if (!assignment) {
      return res.json({
        ok: true,
        stats: {
          hasAssignment: false,
          totalSales: 0,
          totalItemsSold: 0,
          stopsCompleted: 0,
          totalStops: 0,
          status: null,
          startTime: null,
          endTime: null,
          progress: 0
        }
      });
    }

    const totalItemsSold = assignment.inventory?.reduce((sum, i) => sum + (i.quantitySold || 0), 0) || 0;
    const totalSales = assignment.inventory?.reduce(
      (sum, i) => sum + ((i.quantitySold || 0) * (i.foodItem?.price || 0)), 0
    ) || 0;
    const stopsCompleted = assignment.stops?.filter(s => s.status === 'completed').length || 0;
    const totalStops = assignment.stops?.length || 0;
    
    // Calculate time-based stats
    const currentStop = assignment.stops?.find(s => s.status === 'in-progress');
    const currentStopDuration = currentStop?.arrivedAt ? 
      Math.round((new Date() - currentStop.arrivedAt) / 60000) : 0;

    // Calculate average stop duration for completed stops
    const completedStops = assignment.stops?.filter(s => s.status === 'completed') || [];
    const averageStopDuration = completedStops.length > 0 ?
      completedStops.reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / completedStops.length : 0;

    res.json({
      ok: true,
      stats: {
        hasAssignment: true,
        totalSales,
        totalItemsSold,
        stopsCompleted,
        totalStops,
        status: assignment.status,
        startTime: assignment.startTime,
        endTime: assignment.endTime,
        progress: totalStops > 0 ? (stopsCompleted / totalStops) * 100 : 0,
        currentStop: currentStop ? {
          id: currentStop._id,
          name: currentStop.stopName,
          duration: currentStopDuration,
          arrivedAt: currentStop.arrivedAt
        } : null,
        averageStopDuration: Math.round(averageStopDuration),
        remainingInventory: assignment.inventory?.reduce((sum, i) => sum + (i.quantityRemaining || 0), 0) || 0
      }
    });

  } catch (err) {
    console.error("Get rider stats error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/rider/available-items/:assignmentId
 * Get available food items for current assignment
 */
router.get("/available-items/:assignmentId", auth, requireRole("rider"), async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const riderId = req.user.id;

    const assignment = await DailyAssignment.findOne({
      _id: assignmentId,
      rider: riderId
    })
    .populate({
      path: "inventory.foodItem",
      select: "name price category imageUrl description"
    });

    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    const availableItems = assignment.inventory
      .filter(item => item.quantityRemaining > 0)
      .map(item => ({
        id: item.foodItem._id,
        name: item.foodItem.name,
        price: item.foodItem.price,
        category: item.foodItem.category,
        imageUrl: item.foodItem.imageUrl,
        description: item.foodItem.description,
        quantityRemaining: item.quantityRemaining,
        quantitySold: item.quantitySold
      }));

    res.json({
      ok: true,
      items: availableItems,
      totalItems: availableItems.length
    });

  } catch (err) {
    console.error("Get available items error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;