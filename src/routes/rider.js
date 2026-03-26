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
      totalRevenue: a.inventory?.reduce((sum, i) => sum + ((i.quantitySold || 0) * (i.price || 0)), 0) || 0,
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
 * Start the assignment with location tracking
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

    const { lat, lng } = req.body;
    
    assignment.startTime = new Date();
    
    // Record starting location if provided
    if (lat && lng) {
      assignment.currentLocation = { 
        lat, 
        lng, 
        updatedAt: new Date() 
      };
    }
    
    if (assignment.stops && assignment.stops.length > 0) {
      assignment.stops[0].status = "in-progress";
      assignment.stops[0].arrivedAt = new Date();
    }
    
    await assignment.save();

    res.json({ 
      ok: true, 
      message: "Assignment started successfully",
      startTime: assignment.startTime,
      currentStop: assignment.stops[0] || null,
      startLocation: assignment.currentLocation
    });
  } catch (err) {
    console.error("Start assignment error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/rider/sales
 * Rider records a sale with location and time tracking
 */
router.post("/sales", auth, requireRole("rider"), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { assignmentId, foodItemId, qty, stopId, lat, lng } = req.body;

    const assignment = await DailyAssignment.findById(assignmentId).session(session);
    if (!assignment) {
      throw new Error("Assignment not found");
    }

    const item = assignment.inventory.find(i => String(i.foodItem) === String(foodItemId));
    if (!item) {
      throw new Error("Food item not assigned to this assignment");
    }

    if (item.quantityRemaining < qty) {
      throw new Error(`Not enough stock. Only ${item.quantityRemaining} remaining`);
    }

    // Update inventory
    item.quantitySold += qty;
    item.quantityRemaining -= qty;

    let stop = null;
    if (stopId) {
      stop = assignment.stops.find(s => String(s._id) === stopId);
      if (stop) {
        if (!stop.sales) {
          stop.sales = {
            items: [],
            totalRevenue: 0,
            totalItems: 0
          };
        }

        const existingSaleIndex = stop.sales.items.findIndex(
          s => String(s.foodItemId) === String(foodItemId)
        );

        const food = await FoodItem.findById(foodItemId).session(session);
        if (!food) {
          throw new Error("Food item not found");
        }
        
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

    const food = await FoodItem.findById(foodItemId).session(session);
    if (!food) {
      throw new Error("Food item not found");
    }

    const total = food.price * qty;

    // Record the sale with location
    const sale = new SalesTransaction({
      assignment: assignmentId,
      rider: req.user.id,
      foodItem: foodItemId,
      quantity: qty,
      price: food.price,
      total,
      stopId: stopId || null,
      location: lat && lng ? { lat, lng } : null,
      timestamp: new Date()
    });

    await sale.save({ session });

    assignment.totalSales = (assignment.totalSales || 0) + total;
    assignment.totalItemsSold = (assignment.totalItemsSold || 0) + qty;
    
    // Update current location if provided
    if (lat && lng) {
      assignment.currentLocation = { lat, lng, updatedAt: new Date() };
    }
    
    await assignment.save({ session });

    await session.commitTransaction();

    res.json({
      ok: true,
      saleId: sale._id,
      total,
      timestamp: sale.timestamp,
      updatedInventory: {
        foodItemId,
        quantityRemaining: item.quantityRemaining,
        quantitySold: item.quantitySold
      },
      stopSales: stop ? stop.sales : null
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
 * Mark arrival at a stop with location
 */
router.post("/stops/:stopId/arrive", auth, requireRole("rider"), async (req, res) => {
  try {
    const { stopId } = req.params;
    const { assignmentId, lat, lng } = req.body;

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

    assignment.stops[stopIndex].status = "in-progress";
    assignment.stops[stopIndex].arrivedAt = new Date();
    
    // Record arrival location
    if (lat && lng) {
      assignment.currentLocation = { lat, lng, updatedAt: new Date() };
    }

    await assignment.save();

    res.json({ 
      ok: true,
      stop: assignment.stops[stopIndex],
      arrivalTime: assignment.stops[stopIndex].arrivedAt,
      previousStop: stopIndex > 0 ? assignment.stops[stopIndex - 1] : null,
      currentLocation: assignment.currentLocation
    });

  } catch (err) {
    console.error("Stop arrival error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/rider/stops/:stopId/complete
 * Mark stop as complete with location
 */
router.post("/stops/:stopId/complete", auth, requireRole("rider"), async (req, res) => {
  try {
    const { stopId } = req.params;
    const { assignmentId, lat, lng } = req.body;

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

    const allStopsCompleted = assignment.stops.every(s => s.status === "completed");
    if (allStopsCompleted) {
      assignment.status = "completed";
      assignment.endTime = new Date();
    } else {
      const nextStop = assignment.stops[stopIndex + 1];
      if (nextStop && nextStop.status === "pending") {
        nextStop.status = "in-progress";
        nextStop.arrivedAt = new Date();
      }
    }
    
    // Record completion location
    if (lat && lng) {
      assignment.currentLocation = { lat, lng, updatedAt: new Date() };
    }

    await assignment.save();

    res.json({ 
      ok: true,
      stop,
      completionTime: stop.completedAt,
      durationMinutes: stop.durationMinutes,
      allStopsCompleted,
      nextStop: assignment.stops[stopIndex + 1] || null,
      progress: {
        completed: assignment.stops.filter(s => s.status === "completed").length,
        total: assignment.stops.length,
        percentage: (assignment.stops.filter(s => s.status === "completed").length / assignment.stops.length) * 100
      }
    });

  } catch (err) {
    console.error("Complete stop error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/rider/location
 * Update location in real-time with tracking history
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

    // Initialize location history if not exists
    if (!assignment.locationHistory) {
      assignment.locationHistory = [];
    }
    
    // Add to location history (keep last 100 locations)
    assignment.locationHistory.push({
      lat,
      lng,
      timestamp: new Date()
    });
    
    if (assignment.locationHistory.length > 100) {
      assignment.locationHistory.shift();
    }
    
    // Update current location
    assignment.currentLocation = { 
      lat, 
      lng, 
      updatedAt: new Date() 
    };

    await assignment.save();

    res.json({ 
      ok: true,
      currentLocation: assignment.currentLocation,
      lastUpdate: new Date()
    });
  } catch (err) {
    console.error("Location update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/rider/location/history/:assignmentId
 * Get location history for an assignment
 */
router.get("/location/history/:assignmentId", auth, requireRole("rider"), async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const riderId = req.user.id;

    const assignment = await DailyAssignment.findOne({
      _id: assignmentId,
      rider: riderId
    });

    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    res.json({
      ok: true,
      locationHistory: assignment.locationHistory || [],
      currentLocation: assignment.currentLocation
    });

  } catch (err) {
    console.error("Get location history error:", err);
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
      (sum, i) => sum + ((i.quantitySold || 0) * (i.price || 0)), 0
    ) || 0;
    const stopsCompleted = assignment.stops?.filter(s => s.status === 'completed').length || 0;
    
    // Calculate time-based stats
    const currentStop = assignment.stops?.find(s => s.status === 'in-progress');
    const currentStopDuration = currentStop?.arrivedAt ? 
      Math.round((new Date() - currentStop.arrivedAt) / 60000) : 0;

    res.json({
      ok: true,
      stats: {
        hasAssignment: true,
        totalSales,
        totalItemsSold,
        stopsCompleted,
        totalStops: assignment.stops?.length || 0,
        status: assignment.status,
        startTime: assignment.startTime,
        endTime: assignment.endTime,
        progress: assignment.stops?.length > 0 
          ? (stopsCompleted / assignment.stops.length) * 100 
          : 0,
        currentStop: currentStop ? {
          name: currentStop.stopName,
          duration: currentStopDuration,
          arrivedAt: currentStop.arrivedAt
        } : null,
        averageStopDuration: stopsCompleted > 0 ? 
          assignment.stops.filter(s => s.status === 'completed')
            .reduce((sum, s) => sum + (s.durationMinutes || 0), 0) / stopsCompleted : 0
      }
    });

  } catch (err) {
    console.error("Get rider stats error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;