import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { Team } from "../models/Team.js";
import { Route } from "../models/Route.js";
import { FoodItem } from "../models/FoodItem.js";
import { DailyAssignment } from "../models/DailyAssignment.js";
import { PermanentInventory, DailyInventory } from "../models/SupervisorInventory.js";
import mongoose from "mongoose";
import { body, validationResult } from "express-validator";

const router = express.Router();

// Helper function to get today's date at midnight
const getTodayDate = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

// Validation middleware
const validateAssignmentCreate = [
  body("routeId").isMongoId().withMessage("Valid route ID required"),
  body("riderId").isMongoId().withMessage("Valid rider ID required"),
  body("vehicleId").isMongoId().withMessage("Valid vehicle ID required"),
  body("batteryId").isMongoId().withMessage("Valid battery ID required"),
  body("items").isArray({ min: 1 }).withMessage("At least one item required"),
  body("items.*.foodItemId").isMongoId().withMessage("Valid food item ID required"),
  body("items.*.quantity").isInt({ min: 1 }).withMessage("Quantity must be positive")
];

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/**
 * GET /api/supervisor/my-team
 * Supervisor can see only their own team with available resources
 */
router.get("/my-team", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const supervisorId = req.user.id;

    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Find all active assignments for today across the team
    const team = await Team.findOne({ supervisors: supervisorId });

    if (!team) {
      return res.status(404).json({ error: "No team assigned to you" });
    }

    // Find all active assignments for today
    const activeAssignments = await DailyAssignment.find({
      team: team._id,
      date: { $gte: today, $lt: tomorrow },
      status: { $in: ["active", "pending"] }
    }).select('vehicle battery rider').lean();

    // Extract IDs of resources currently in use
    const assignedVehicleIds = activeAssignments
      .map(a => a.vehicle?.toString())
      .filter(id => id);
    
    const assignedBatteryIds = activeAssignments
      .map(a => a.battery?.toString())
      .filter(id => id);
    
    const assignedRiderIds = activeAssignments
      .map(a => a.rider?.toString())
      .filter(id => id);

    // Fetch team with populated data
    const populatedTeam = await Team.findOne({ supervisors: supervisorId })
      .populate([
        { path: "supervisors", select: "name email role" },
        { 
          path: "riders", 
          select: "name email role status",
          transform: (doc) => {
            if (doc && assignedRiderIds.includes(doc._id.toString())) {
              doc.status = 'Active';
            }
            return doc;
          }
        },
        { path: "cooks", select: "name email role" },
        { path: "refillCoordinators", select: "name email role" },
        { 
          path: "vehicles", 
          select: "name registrationNo status type",
          match: { _id: { $nin: assignedVehicleIds } }
        },
        { 
          path: "batteries", 
          select: "imei status type capacity charge health",
          match: { _id: { $nin: assignedBatteryIds } }
        },
        {
          path: "routes",
          select: "name rider refillCoordinator stops status",
          populate: [
            { path: "rider", select: "name email" },
            { path: "refillCoordinator", select: "name email" }
          ]
        }
      ])
      .lean();

    if (!populatedTeam) {
      return res.status(404).json({ error: "No team assigned to you" });
    }

    // Format response with availability info
    const response = {
      id: String(populatedTeam._id),
      name: populatedTeam.name,
      createdAt: populatedTeam.createdAt,
      supervisors: populatedTeam.supervisors?.map(u => ({ 
        _id: String(u._id), 
        name: u.name, 
        email: u.email 
      })) || [],
      riders: populatedTeam.riders?.map(u => ({ 
        _id: String(u._id), 
        name: u.name, 
        email: u.email,
        status: assignedRiderIds.includes(String(u._id)) ? 'Active' : (u.status || 'Available')
      })) || [],
      cooks: populatedTeam.cooks?.map(u => ({ 
        _id: String(u._id), 
        name: u.name, 
        email: u.email 
      })) || [],
      refillCoordinators: populatedTeam.refillCoordinators?.map(u => ({ 
        _id: String(u._id), 
        name: u.name, 
        email: u.email 
      })) || [],
      vehicles: populatedTeam.vehicles?.map(v => ({ 
        _id: String(v._id), 
        registrationNo: v.registrationNo, 
        type: v.type || 'Cart',
        status: 'Available'
      })) || [],
      batteries: populatedTeam.batteries?.map(b => ({ 
        _id: String(b._id), 
        imei: b.imei, 
        type: b.type, 
        capacity: b.capacity,
        charge: b.charge || 100,
        health: b.health || 100,
        status: b.status || 'Good'
      })) || [],
      routes: populatedTeam.routes?.map(r => ({
        _id: String(r._id),
        name: r.name,
        stops: r.stops || [],
        rider: r.rider ? { _id: String(r.rider._id), name: r.rider.name } : null,
        refillCoordinator: r.refillCoordinator ? { _id: String(r.refillCoordinator._id), name: r.refillCoordinator.name } : null,
        status: r.status || 'Available'
      })) || [],
      activeAssignments: activeAssignments.map(a => ({
        vehicleId: a.vehicle,
        batteryId: a.battery,
        riderId: a.rider
      }))
    };

    res.json({ ok: true, team: response });

  } catch (err) {
    console.error("Supervisor my-team error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/supervisor/assignments/available-items
 * Get available items from BOTH daily AND permanent inventory for assignment
 */
router.get("/assignments/available-items", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const today = getTodayDate();

    console.log(`[Available Items] Fetching for supervisor: ${supervisorId}`);

    // Get daily inventory (temporary items)
    let dailyInventory = null;
    try {
      dailyInventory = await DailyInventory.findOne({
        supervisor: supervisorId,
        date: today
      }).populate({
        path: "items.foodItem",
        select: "name price category imageUrl unit isPermanent"
      });
      console.log(`[Available Items] Daily inventory found: ${!!dailyInventory}`);
    } catch (err) {
      console.error("[Available Items] Error fetching daily inventory:", err);
    }

    // Get permanent inventory
    let permanentInventory = null;
    try {
      permanentInventory = await PermanentInventory.findOne({
        supervisor: supervisorId,
      }).populate({
        path: "items.foodItem",
        select: "name price category imageUrl unit isPermanent"
      });
      console.log(`[Available Items] Permanent inventory found: ${!!permanentInventory}`);
    } catch (err) {
      console.error("[Available Items] Error fetching permanent inventory:", err);
    }

    const allItems = [];

    // Add daily/temporary items
    if (dailyInventory && dailyInventory.items && Array.isArray(dailyInventory.items)) {
      for (const item of dailyInventory.items) {
        try {
          // Skip if foodItem is missing
          if (!item.foodItem || !item.foodItem._id) {
            console.log("[Available Items] Skipping daily item - missing foodItem reference");
            continue;
          }
          
          if (item.status !== "active") continue;
          
          const available = (item.quantity || 0) - (item.locked || 0);
          if (available <= 0) continue;
          
          allItems.push({
            foodItemId: item.foodItem._id,
            name: item.foodItem.name || "Unknown",
            price: item.foodItem.price || 0,
            category: item.foodItem.category || "Uncategorized",
            totalQuantity: item.quantity || 0,
            locked: item.locked || 0,
            available: available,
            unit: item.foodItem.unit || "piece",
            imageUrl: item.foodItem.imageUrl || null,
            isPermanent: false,
            source: "daily",
            inventoryId: dailyInventory._id
          });
        } catch (err) {
          console.error("[Available Items] Error processing daily item:", err);
        }
      }
    }

    // Add permanent items
    if (permanentInventory && permanentInventory.items && Array.isArray(permanentInventory.items)) {
      for (const item of permanentInventory.items) {
        try {
          // Skip if foodItem is missing
          if (!item.foodItem || !item.foodItem._id) {
            console.log("[Available Items] Skipping permanent item - missing foodItem reference");
            continue;
          }
          
          if (item.status !== "active") continue;
          
          const available = (item.quantity || 0) - (item.locked || 0);
          if (available <= 0) continue;
          
          allItems.push({
            foodItemId: item.foodItem._id,
            name: item.foodItem.name || "Unknown",
            price: item.foodItem.price || 0,
            category: item.foodItem.category || "Uncategorized",
            totalQuantity: item.quantity || 0,
            locked: item.locked || 0,
            available: available,
            unit: item.foodItem.unit || "piece",
            imageUrl: item.foodItem.imageUrl || null,
            isPermanent: true,
            source: "permanent",
            inventoryId: permanentInventory._id
          });
        } catch (err) {
          console.error("[Available Items] Error processing permanent item:", err);
        }
      }
    }

    const totalAvailable = allItems.reduce((sum, item) => sum + (item.available || 0), 0);
    const totalAvailableValue = allItems.reduce((sum, item) => sum + ((item.available || 0) * (item.price || 0)), 0);

    console.log(`[Available Items] Returning ${allItems.length} items`);

    res.json({
      ok: true,
      items: allItems,
      summary: {
        totalItems: allItems.length,
        totalAvailable: totalAvailable,
        totalValue: totalAvailableValue,
        dailyCount: allItems.filter(i => !i.isPermanent).length,
        permanentCount: allItems.filter(i => i.isPermanent).length
      }
    });

  } catch (err) {
    console.error("[Available Items] Fatal error:", err);
    res.status(500).json({ 
      ok: false,
      error: "Server error fetching available items",
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

/**
 * GET /api/supervisor/assignments/today
 * Get all assignments created today
 */
router.get("/assignments/today", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const today = getTodayDate();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const assignments = await DailyAssignment.find({
      supervisor: supervisorId,
      date: {
        $gte: today,
        $lt: tomorrow
      }
    })
    .populate("rider", "name email")
    .populate("vehicle", "registrationNo type")
    .populate("battery", "imei charge health")
    .populate("route", "name")
    .populate("inventory.foodItem", "name price")
    .sort({ createdAt: -1 });

    const summary = {
      total: assignments.length,
      totalItemsAssigned: assignments.reduce(
        (sum, a) => sum + (a.inventory?.reduce((s, i) => s + (i.quantityAssigned || 0), 0) || 0), 0
      ),
      totalValue: assignments.reduce(
        (sum, a) => sum + (a.inventory?.reduce((s, i) => s + ((i.price || 0) * (i.quantityAssigned || 0)), 0) || 0), 0
      )
    };

    res.json({
      ok: true,
      assignments,
      summary
    });

  } catch (err) {
    console.error("Get today's assignments error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/supervisor/assignments/create
 * Create assignment with inventory locking and resource availability check
 */
router.post(
  "/assignments/create",
  auth,
  requireRole("supervisor"),
  validateAssignmentCreate,
  handleValidationErrors,
  async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const supervisorId = req.user.id;
      const {
        routeId,
        riderId,
        vehicleId,
        batteryId,
        refillCoordinatorId,
        items
      } = req.body;

      // 1. Validate team exists
      const team = await Team.findOne({ supervisors: supervisorId }).session(session);
      if (!team) {
        throw new Error("Team not found");
      }

      // 2. Get today's date range
      const today = getTodayDate();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // 3. Check if resources are already assigned today
      const existingAssignments = await DailyAssignment.find({
        team: team._id,
        date: { $gte: today, $lt: tomorrow },
        status: { $in: ["active", "pending"] },
        $or: [
          { vehicle: vehicleId },
          { battery: batteryId },
          { rider: riderId }
        ]
      }).session(session);

      if (existingAssignments.length > 0) {
        const conflicts = [];
        existingAssignments.forEach(assignment => {
          if (String(assignment.vehicle) === String(vehicleId)) {
            conflicts.push('vehicle');
          }
          if (String(assignment.battery) === String(batteryId)) {
            conflicts.push('battery');
          }
          if (String(assignment.rider) === String(riderId)) {
            conflicts.push('rider');
          }
        });
        
        throw new Error(`Resource(s) already assigned today: ${conflicts.join(', ')}`);
      }

      // 4. Validate route exists and get stops
      const route = await Route.findById(routeId).session(session);
      if (!route) {
        throw new Error("Route not found");
      }

      // 5. Get today's DAILY inventory and PERMANENT inventory
      const dailyInventory = await DailyInventory.findOne({
        supervisor: supervisorId,
        date: today
      }).session(session);

      const permanentInventory = await PermanentInventory.findOne({
        supervisor: supervisorId
      }).session(session);

      if (!dailyInventory && !permanentInventory) {
        throw new Error("No inventory found. Please add items to inventory first.");
      }

      // 6. Validate all requested items exist in inventory and have sufficient quantity
      const foodIds = items.map(i => i.foodItemId);
      const foods = await FoodItem.find({ _id: { $in: foodIds } }).session(session);

      if (foods.length !== items.length) {
        throw new Error("One or more food items are invalid");
      }

      // Check inventory quantities and prepare assignment items
      const assignmentItems = [];

      for (const requestedItem of items) {
        const foodItem = foods.find(f => String(f._id) === String(requestedItem.foodItemId));
        
        // Try to find in daily inventory first
        let inventoryItem = null;
        let inventorySource = null;
        let inventoryDoc = null;
        
        if (dailyInventory) {
          inventoryItem = dailyInventory.items.find(
            item => String(item.foodItem) === String(requestedItem.foodItemId)
          );
          if (inventoryItem) {
            inventorySource = "daily";
            inventoryDoc = dailyInventory;
          }
        }
        
        // If not found in daily, check permanent inventory
        if (!inventoryItem && permanentInventory) {
          inventoryItem = permanentInventory.items.find(
            item => String(item.foodItem) === String(requestedItem.foodItemId)
          );
          if (inventoryItem) {
            inventorySource = "permanent";
            inventoryDoc = permanentInventory;
          }
        }

        if (!inventoryItem) {
          throw new Error(`${foodItem.name} is not in any inventory`);
        }

        const available = (inventoryItem.quantity || 0) - (inventoryItem.locked || 0);
        
        if (requestedItem.quantity > available) {
          throw new Error(
            `Insufficient stock for ${foodItem.name}. ` +
            `Requested: ${requestedItem.quantity}, Available: ${available}`
          );
        }

        // Prepare assignment item with source tracking
        assignmentItems.push({
          foodItem: foodItem._id,
          name: foodItem.name,
          price: foodItem.price,
          quantityAssigned: requestedItem.quantity,
          quantityRemaining: requestedItem.quantity,
          quantitySold: 0,
          source: inventorySource,
          inventoryId: inventoryDoc._id
        });

        // Lock inventory for both daily AND permanent items
        inventoryItem.locked = (inventoryItem.locked || 0) + requestedItem.quantity;
      }

      // Save inventory changes
      if (dailyInventory) await dailyInventory.save({ session });
      if (permanentInventory) await permanentInventory.save({ session });

      // 7. Format stops properly with address and sales tracking
      const formattedStops = (route.stops || []).map(stop => ({
        stopName: stop.name || (typeof stop === 'string' ? stop : 'Unnamed Stop'),
        address: stop.address || '',
        status: "pending",
        arrivedAt: null,
        completedAt: null,
        durationMinutes: 0,
        sales: { items: [], totalRevenue: 0, totalItems: 0 }
      }));

      // 8. Create the assignment with pending status
      const [assignment] = await DailyAssignment.create([{
        date: today,
        team: team._id,
        route: routeId,
        supervisor: supervisorId,
        rider: riderId,
        vehicle: vehicleId,
        battery: batteryId,
        refillCoordinator: refillCoordinatorId,
        inventory: assignmentItems,
        stops: formattedStops,
        status: "pending",
        createdBy: supervisorId,
        startTime: null,
        endTime: null
      }], { session });

      // 9. Commit the transaction
      await session.commitTransaction();

      // 10. Return success with assignment details
      const populatedAssignment = await DailyAssignment.findById(assignment._id)
        .populate("rider", "name email")
        .populate("vehicle", "registrationNo")
        .populate("battery", "imei")
        .populate("route", "name")
        .populate("inventory.foodItem", "name price");

      res.json({
        ok: true,
        message: "Assignment created successfully and pending rider acceptance",
        assignmentId: assignment._id,
        assignment: populatedAssignment
      });

    } catch (err) {
      await session.abortTransaction();
      console.error("Create assignment error:", err);
      
      if (err.message.includes("already assigned")) {
        return res.status(409).json({ error: err.message });
      }
      if (err.message.includes("not found") || err.message.includes("No inventory")) {
        return res.status(404).json({ error: err.message });
      }
      if (err.message.includes("Insufficient")) {
        return res.status(400).json({ error: err.message });
      }
      
      res.status(500).json({ error: "Server error creating assignment" });
    } finally {
      session.endSession();
    }
  }
);

/**
 * POST /api/supervisor/assignments/:id/start
 * Rider starts assignment (kept for compatibility)
 */
router.post("/assignments/:id/start", auth, requireRole("rider"), async (req, res) => {
  try {
    const assignment = await DailyAssignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ error: "Assignment not found" });

    if (String(assignment.rider) !== req.user.id) {
      return res.status(403).json({ error: "Not your assignment" });
    }

    if (assignment.status !== "active") {
      return res.status(400).json({ error: "Assignment must be accepted before starting" });
    }

    assignment.startTime = new Date();
    await assignment.save();

    res.json({ ok: true, assignment });
  } catch (err) {
    console.error("Start assignment error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/supervisor/assignments/:id/close
 * Close assignment and update inventory
 */
router.post("/assignments/:id/close", auth, requireRole("supervisor"), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const assignment = await DailyAssignment.findById(req.params.id)
      .session(session);

    if (!assignment) {
      throw new Error("Assignment not found");
    }

    if (String(assignment.supervisor) !== req.user.id) {
      throw new Error("Not authorized to close this assignment");
    }

    if (assignment.status === "completed") {
      throw new Error("Assignment is already completed");
    }

    const supervisorId = assignment.supervisor;
    const today = getTodayDate();

    // Process inventory updates for each assigned item
    for (const assignedItem of assignment.inventory) {
      const soldQuantity = assignedItem.quantitySold || 0;
      const assignedQuantity = assignedItem.quantityAssigned;
      
      let targetInventory = null;
      
      // Find the correct inventory based on source
      if (assignedItem.source === "daily") {
        targetInventory = await DailyInventory.findOne({
          supervisor: supervisorId,
          date: today
        }).session(session);
      } else if (assignedItem.source === "permanent") {
        targetInventory = await PermanentInventory.findOne({
          supervisor: supervisorId
        }).session(session);
      }
      
      if (targetInventory) {
        const inventoryItem = targetInventory.items.find(
          item => String(item.foodItem) === String(assignedItem.foodItem)
        );
        
        if (inventoryItem) {
          // For daily items: deduct sold quantity from inventory
          if (assignedItem.source === "daily" && soldQuantity > 0) {
            inventoryItem.quantity -= soldQuantity;
            console.log(`Deducted ${soldQuantity} of ${assignedItem.name} from daily inventory`);
          }
          
          // For permanent items: don't deduct, just track
          if (assignedItem.source === "permanent" && soldQuantity > 0) {
            console.log(`Permanent item ${assignedItem.name} sold - no inventory deduction`);
          }
          
          // Unlock the assigned items (return to available pool for both types)
          inventoryItem.locked = Math.max(0, (inventoryItem.locked || 0) - assignedQuantity);
          
          await targetInventory.save({ session });
        }
      }
    }

    assignment.status = "completed";
    assignment.endTime = new Date();
    assignment.closedAt = new Date();
    assignment.closedBy = req.user.id;
    assignment.inventoryReturned = true;
    
    assignment.totalItemsSold = assignment.inventory.reduce(
      (sum, item) => sum + (item.quantitySold || 0), 0
    );
    assignment.totalSales = assignment.inventory.reduce(
      (sum, item) => sum + ((item.quantitySold || 0) * (item.price || 0)), 0
    );

    await assignment.save({ session });

    await session.commitTransaction();

    res.json({ 
      ok: true,
      message: "Assignment closed successfully",
      summary: {
        totalItemsSold: assignment.totalItemsSold,
        totalSales: assignment.totalSales,
        endTime: assignment.endTime
      }
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Close assignment error:", err);
    
    if (err.message.includes("not found")) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes("Not authorized")) {
      return res.status(403).json({ error: err.message });
    }
    if (err.message.includes("already completed")) {
      return res.status(400).json({ error: err.message });
    }
    
    res.status(500).json({ error: "Server error" });
  } finally {
    session.endSession();
  }
});

/**
 * GET /api/supervisor/assignments/:id
 * Get single assignment details
 */
router.get("/assignments/:id", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const assignment = await DailyAssignment.findById(req.params.id)
      .populate("rider", "name email")
      .populate("vehicle", "registrationNo type")
      .populate("battery", "imei charge health")
      .populate("route", "name stops")
      .populate("inventory.foodItem", "name price category");

    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    if (String(assignment.supervisor) !== req.user.id) {
      return res.status(403).json({ error: "Not authorized to view this assignment" });
    }

    res.json({
      ok: true,
      assignment
    });
  } catch (err) {
    console.error("Get assignment error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * DELETE /api/supervisor/assignments/:id
 * Delete/cancel assignment and free all resources
 */
// In your backend routes file, replace the DELETE endpoint with this:

/**
 * DELETE /api/supervisor/assignments/:id
 * Delete/cancel assignment and free all resources
 */
// In your backend routes file, replace the DELETE endpoint with this improved version:

/**
 * DELETE /api/supervisor/assignments/:id
 * Delete/cancel assignment and free all resources
 */
router.delete("/assignments/:id", auth, requireRole("supervisor"), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const assignmentId = req.params.id;
    const supervisorId = req.user.id;

    console.log(`[DELETE] Attempting to delete assignment: ${assignmentId}`);
    console.log(`[DELETE] Supervisor ID: ${supervisorId}`);

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
      await session.abortTransaction();
      return res.status(400).json({ error: "Invalid assignment ID format" });
    }

    const assignment = await DailyAssignment.findById(assignmentId)
      .session(session);

    if (!assignment) {
      await session.abortTransaction();
      console.log(`[DELETE] Assignment not found: ${assignmentId}`);
      return res.status(404).json({ error: "Assignment not found" });
    }

    console.log(`[DELETE] Assignment found:`, {
      id: assignment._id,
      status: assignment.status,
      supervisor: assignment.supervisor,
      userSupervisor: supervisorId
    });

    // Check authorization
    if (String(assignment.supervisor) !== String(supervisorId)) {
      await session.abortTransaction();
      console.log(`[DELETE] Authorization failed - Supervisor mismatch`);
      return res.status(403).json({ error: "Not authorized to delete this assignment" });
    }

    // Allow deletion of pending or active assignments
    // Only prevent deletion of completed assignments
    if (assignment.status === "completed") {
      await session.abortTransaction();
      console.log(`[DELETE] Cannot delete completed assignment`);
      return res.status(400).json({ error: "Cannot delete completed assignments. Use close instead." });
    }

    // If already cancelled, just return success
    if (assignment.status === "cancelled") {
      await session.commitTransaction();
      console.log(`[DELETE] Assignment already cancelled`);
      return res.json({
        ok: true,
        message: "Assignment already cancelled"
      });
    }

    const today = getTodayDate();
    console.log(`[DELETE] Today's date: ${today}`);

    // Process inventory unlocks for each assigned item
    let unlockedCount = 0;
    
    for (const assignedItem of assignment.inventory) {
      console.log(`[DELETE] Processing item: ${assignedItem.name || assignedItem.foodItem}, source: ${assignedItem.source}`);
      
      let targetInventory = null;
      
      if (assignedItem.source === "daily") {
        targetInventory = await DailyInventory.findOne({
          supervisor: supervisorId,
          date: today
        }).session(session);
        console.log(`[DELETE] Looking for daily inventory: ${!!targetInventory}`);
      } else if (assignedItem.source === "permanent") {
        targetInventory = await PermanentInventory.findOne({
          supervisor: supervisorId
        }).session(session);
        console.log(`[DELETE] Looking for permanent inventory: ${!!targetInventory}`);
      }
      
      if (targetInventory && targetInventory.items) {
        const inventoryItem = targetInventory.items.find(
          item => String(item.foodItem) === String(assignedItem.foodItem)
        );
        
        if (inventoryItem) {
          const currentLocked = inventoryItem.locked || 0;
          const toUnlock = assignedItem.quantityAssigned || 0;
          inventoryItem.locked = Math.max(0, currentLocked - toUnlock);
          
          console.log(`[DELETE] Unlocked ${toUnlock} of ${assignedItem.name} from ${assignedItem.source} inventory. New locked: ${inventoryItem.locked}`);
          await targetInventory.save({ session });
          unlockedCount++;
        } else {
          console.log(`[DELETE] Inventory item not found for: ${assignedItem.name}`);
        }
      } else {
        console.log(`[DELETE] Target inventory not found for source: ${assignedItem.source}`);
      }
    }

    console.log(`[DELETE] Unlocked ${unlockedCount} items`);

    // Update assignment status
    assignment.status = "cancelled";
    assignment.endTime = new Date();
    assignment.closedAt = new Date();
    assignment.closedBy = supervisorId;
    assignment.inventoryReturned = true;
    assignment.cancellationReason = req.body.reason || "Cancelled by supervisor";
    assignment.deletedAt = new Date();
    
    await assignment.save({ session });
    console.log(`[DELETE] Assignment status updated to: ${assignment.status}`);
    
    await session.commitTransaction();
    console.log(`[DELETE] Transaction committed successfully`);

    res.json({
      ok: true,
      message: "Assignment cancelled successfully and resources freed",
      assignment: {
        _id: assignment._id,
        status: assignment.status,
        cancelledAt: assignment.closedAt
      }
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("[DELETE] Error details:", err);
    console.error("[DELETE] Error stack:", err.stack);
    
    res.status(500).json({ 
      ok: false,
      error: "Server error deleting assignment",
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  } finally {
    session.endSession();
  }
});
/**
 * PUT /api/supervisor/assignments/:id
 * Edit pending assignment (add/remove items, change resources)
 */
router.put("/assignments/:id", auth, requireRole("supervisor"), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const assignmentId = req.params.id;
    const supervisorId = req.user.id;
    const {
      riderId,
      vehicleId,
      batteryId,
      items // array of { foodItemId, quantity }
    } = req.body;

    // Find the assignment
    const assignment = await DailyAssignment.findById(assignmentId)
      .session(session);

    if (!assignment) {
      throw new Error("Assignment not found");
    }

    // Check if supervisor owns this assignment
    if (String(assignment.supervisor) !== supervisorId) {
      throw new Error("Not authorized to edit this assignment");
    }

    // Only allow editing of pending assignments
    if (assignment.status !== "pending") {
      throw new Error("Can only edit pending assignments");
    }

    const today = getTodayDate();

    // First, unlock all currently locked inventory
    for (const assignedItem of assignment.inventory) {
      let targetInventory = null;
      
      if (assignedItem.source === "daily") {
        targetInventory = await DailyInventory.findOne({
          supervisor: supervisorId,
          date: today
        }).session(session);
      } else if (assignedItem.source === "permanent") {
        targetInventory = await PermanentInventory.findOne({
          supervisor: supervisorId
        }).session(session);
      }
      
      if (targetInventory && targetInventory.items) {
        const inventoryItem = targetInventory.items.find(
          item => String(item.foodItem) === String(assignedItem.foodItem)
        );
        
        if (inventoryItem) {
          inventoryItem.locked = Math.max(0, (inventoryItem.locked || 0) - (assignedItem.quantityAssigned || 0));
          await targetInventory.save({ session });
        }
      }
    }

    // If items are being updated, lock new inventory
    if (items && items.length > 0) {
      const foodIds = items.map(i => i.foodItemId);
      const foods = await FoodItem.find({ _id: { $in: foodIds } }).session(session);
      
      const dailyInventory = await DailyInventory.findOne({
        supervisor: supervisorId,
        date: today
      }).session(session);
      
      const permanentInventory = await PermanentInventory.findOne({
        supervisor: supervisorId
      }).session(session);
      
      const newAssignmentItems = [];
      
      for (const requestedItem of items) {
        const foodItem = foods.find(f => String(f._id) === String(requestedItem.foodItemId));
        
        let inventoryItem = null;
        let inventorySource = null;
        let inventoryDoc = null;
        
        if (dailyInventory) {
          inventoryItem = dailyInventory.items.find(
            item => String(item.foodItem) === String(requestedItem.foodItemId)
          );
          if (inventoryItem) {
            inventorySource = "daily";
            inventoryDoc = dailyInventory;
          }
        }
        
        if (!inventoryItem && permanentInventory) {
          inventoryItem = permanentInventory.items.find(
            item => String(item.foodItem) === String(requestedItem.foodItemId)
          );
          if (inventoryItem) {
            inventorySource = "permanent";
            inventoryDoc = permanentInventory;
          }
        }
        
        if (!inventoryItem) {
          throw new Error(`${foodItem?.name || 'Item'} is not in any inventory`);
        }
        
        const available = (inventoryItem.quantity || 0) - (inventoryItem.locked || 0);
        
        if (requestedItem.quantity > available) {
          throw new Error(
            `Insufficient stock for ${foodItem?.name || 'item'}. ` +
            `Requested: ${requestedItem.quantity}, Available: ${available}`
          );
        }
        
        newAssignmentItems.push({
          foodItem: foodItem._id,
          name: foodItem.name,
          price: foodItem.price,
          quantityAssigned: requestedItem.quantity,
          quantityRemaining: requestedItem.quantity,
          quantitySold: 0,
          source: inventorySource,
          inventoryId: inventoryDoc._id
        });
        
        inventoryItem.locked = (inventoryItem.locked || 0) + requestedItem.quantity;
      }
      
      if (dailyInventory) await dailyInventory.save({ session });
      if (permanentInventory) await permanentInventory.save({ session });
      
      assignment.inventory = newAssignmentItems;
    }
    
    // Update resources if provided
    if (riderId) assignment.rider = riderId;
    if (vehicleId) assignment.vehicle = vehicleId;
    if (batteryId) assignment.battery = batteryId;
    
    assignment.updatedAt = new Date();
    await assignment.save({ session });
    
    await session.commitTransaction();
    
    const updatedAssignment = await DailyAssignment.findById(assignmentId)
      .populate("rider", "name email")
      .populate("vehicle", "registrationNo")
      .populate("battery", "imei")
      .populate("route", "name")
      .populate("inventory.foodItem", "name price");
    
    res.json({
      ok: true,
      message: "Assignment updated successfully",
      assignment: updatedAssignment
    });
    
  } catch (err) {
    await session.abortTransaction();
    console.error("Edit assignment error:", err);
    
    if (err.message.includes("not found")) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes("Not authorized")) {
      return res.status(403).json({ error: err.message });
    }
    if (err.message.includes("Can only edit")) {
      return res.status(400).json({ error: err.message });
    }
    if (err.message.includes("Insufficient")) {
      return res.status(400).json({ error: err.message });
    }
    
    res.status(500).json({ error: "Server error editing assignment" });
  } finally {
    session.endSession();
  }
});

/**
 * POST /api/supervisor/assignments/:id/cancel
 * Alternative: Cancel assignment (same as delete but more explicit)
 */
router.post("/assignments/:id/cancel", auth, requireRole("supervisor"), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const assignmentId = req.params.id;
    const supervisorId = req.user.id;
    const { reason } = req.body;

    const assignment = await DailyAssignment.findById(assignmentId)
      .session(session);

    if (!assignment) {
      throw new Error("Assignment not found");
    }

    if (String(assignment.supervisor) !== supervisorId) {
      throw new Error("Not authorized to cancel this assignment");
    }

    if (assignment.status === "completed") {
      throw new Error("Cannot cancel completed assignments");
    }

    const today = getTodayDate();

    // Process inventory unlocks for each assigned item
    for (const assignedItem of assignment.inventory) {
      let targetInventory = null;
      
      if (assignedItem.source === "daily") {
        targetInventory = await DailyInventory.findOne({
          supervisor: supervisorId,
          date: today
        }).session(session);
      } else if (assignedItem.source === "permanent") {
        targetInventory = await PermanentInventory.findOne({
          supervisor: supervisorId
        }).session(session);
      }
      
      if (targetInventory) {
        const inventoryItem = targetInventory.items.find(
          item => String(item.foodItem) === String(assignedItem.foodItem)
        );
        
        if (inventoryItem) {
          inventoryItem.locked = Math.max(0, (inventoryItem.locked || 0) - assignedItem.quantityAssigned);
          await targetInventory.save({ session });
        }
      }
    }

    assignment.status = "cancelled";
    assignment.endTime = new Date();
    assignment.closedAt = new Date();
    assignment.closedBy = supervisorId;
    assignment.cancellationReason = reason || "Cancelled by supervisor";
    
    await assignment.save({ session });

    await session.commitTransaction();

    res.json({
      ok: true,
      message: "Assignment cancelled successfully",
      assignment: {
        _id: assignment._id,
        status: assignment.status,
        cancelledAt: assignment.closedAt
      }
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("Cancel assignment error:", err);
    
    if (err.message.includes("not found")) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes("Not authorized")) {
      return res.status(403).json({ error: err.message });
    }
    if (err.message.includes("Cannot cancel")) {
      return res.status(400).json({ error: err.message });
    }
    
    res.status(500).json({ error: "Server error cancelling assignment" });
  } finally {
    session.endSession();
  }
});

export default router;