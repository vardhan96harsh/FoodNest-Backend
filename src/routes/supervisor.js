import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { Team } from "../models/Team.js";
import { Route } from "../models/Route.js";
import { FoodItem } from "../models/FoodItem.js";
import { DailyAssignment } from "../models/DailyAssignment.js";
import { SupervisorInventory } from "../models/SupervisorInventory.js";
import mongoose from "mongoose";
import { body, validationResult } from "express-validator";

const router = express.Router();

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
 * Supervisor can see only their own team
 */
router.get("/my-team", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const supervisorId = req.user.id;

    const team = await Team.findOne({ supervisors: supervisorId })
      .populate([
        { path: "supervisors", select: "name email role" },
        { path: "riders", select: "name email role" },
        { path: "cooks", select: "name email role" },
        { path: "refillCoordinators", select: "name email role" },
        { path: "vehicles", select: "name registrationNo status type" },
        { path: "batteries", select: "imei status type capacity charge health" },
        {
          path: "routes",
          select: "name rider refillCoordinator stops",
          populate: [
            { path: "rider", select: "name email" },
            { path: "refillCoordinator", select: "name email" }
          ]
        }
      ])
      .lean();

    if (!team) {
      return res.status(404).json({ error: "No team assigned to you" });
    }

    // Clean response for frontend
    const response = {
      id: String(team._id),
      name: team.name,
      createdAt: team.createdAt,
      supervisors: team.supervisors?.map(u => ({ 
        _id: String(u._id), 
        name: u.name, 
        email: u.email 
      })) || [],
      riders: team.riders?.map(u => ({ 
        _id: String(u._id), 
        name: u.name, 
        email: u.email,
        status: u.status || 'Available'
      })) || [],
      cooks: team.cooks?.map(u => ({ 
        _id: String(u._id), 
        name: u.name, 
        email: u.email 
      })) || [],
      refillCoordinators: team.refillCoordinators?.map(u => ({ 
        _id: String(u._id), 
        name: u.name, 
        email: u.email 
      })) || [],
      vehicles: team.vehicles?.map(v => ({ 
        _id: String(v._id), 
        registrationNo: v.registrationNo, 
        type: v.type || 'Cart',
        status: v.status || 'Available'
      })) || [],
      batteries: team.batteries?.map(b => ({ 
        _id: String(b._id), 
        imei: b.imei, 
        type: b.type, 
        capacity: b.capacity,
        charge: b.charge || 100,
        health: b.health || 100,
        status: b.status || 'Good'
      })) || [],
      routes: team.routes?.map(r => ({
        _id: String(r._id),
        name: r.name,
        stops: r.stops || [],
        rider: r.rider ? { _id: String(r.rider._id), name: r.rider.name } : null,
        refillCoordinator: r.refillCoordinator ? { _id: String(r.refillCoordinator._id), name: r.refillCoordinator.name } : null,
        status: r.status || 'Available'
      })) || []
    };

    res.json({ ok: true, team: response });

  } catch (err) {
    console.error("Supervisor my-team error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/supervisor/assignments/available-items
 * Get available items from today's inventory for assignment
 */
router.get("/assignments/available-items", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get today's inventory
    const inventory = await SupervisorInventory.findOne({
      supervisor: supervisorId,
      date: today
    }).populate({
      path: "items.foodItem",
      select: "name price category imageUrl"
    });

    if (!inventory) {
      return res.json({
        ok: true,
        items: [],
        summary: {
          totalItems: 0,
          totalAvailable: 0
        }
      });
    }

    // Calculate available quantities (total - locked)
    const availableItems = inventory.items
      .map(item => {
        const available = item.quantity - (item.locked || 0);
        return {
          foodItemId: item.foodItem._id,
          name: item.foodItem.name,
          price: item.foodItem.price,
          category: item.foodItem.category,
          totalQuantity: item.quantity,
          locked: item.locked || 0,
          available: available,
          imageUrl: item.foodItem.imageUrl
        };
      })
      .filter(item => item.available > 0); // Only show items with stock

    res.json({
      ok: true,
      items: availableItems,
      summary: {
        totalItems: availableItems.length,
        totalAvailable: availableItems.reduce((sum, item) => sum + item.available, 0)
      }
    });

  } catch (err) {
    console.error("Get available items error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/supervisor/assignments/today
 * Get all assignments created today
 */
router.get("/assignments/today", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
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

    // Calculate summary
    const summary = {
      total: assignments.length,
      totalItemsAssigned: assignments.reduce(
        (sum, a) => sum + a.inventory.reduce((s, i) => s + i.quantityAssigned, 0), 0
      ),
      totalValue: assignments.reduce(
        (sum, a) => sum + a.inventory.reduce((s, i) => s + (i.price * i.quantityAssigned), 0), 0
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
 * Create assignment with inventory locking
 */
router.post(
  "/assignments/create",
  auth,
  requireRole("supervisor"),
  validateAssignmentCreate,
  handleValidationErrors,
  async (req, res) => {
    // Start a MongoDB session for transaction
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
        items  // Array of { foodItemId, quantity }
      } = req.body;

      // 1. Validate team exists
      const team = await Team.findOne({ supervisors: supervisorId }).session(session);
      if (!team) {
        throw new Error("Team not found");
      }

      // 2. Validate route exists
      const route = await Route.findById(routeId).session(session);
      if (!route) {
        throw new Error("Route not found");
      }

      // 3. Get today's inventory
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const inventory = await SupervisorInventory.findOne({
        supervisor: supervisorId,
        date: today
      }).session(session);

      if (!inventory) {
        throw new Error("No inventory found for today. Please add items to inventory first.");
      }

      // 4. Validate all requested items exist in inventory and have sufficient quantity
      const foodIds = items.map(i => i.foodItemId);
      const foods = await FoodItem.find({ _id: { $in: foodIds } }).session(session);

      if (foods.length !== items.length) {
        throw new Error("One or more food items are invalid");
      }

      // Check inventory quantities and prepare assignment items
      const assignmentItems = [];

      for (const requestedItem of items) {
        const foodItem = foods.find(f => String(f._id) === String(requestedItem.foodItemId));
        
        // Find this item in supervisor's inventory
        const inventoryItem = inventory.items.find(
          item => String(item.foodItem) === String(requestedItem.foodItemId)
        );

        if (!inventoryItem) {
          throw new Error(`${foodItem.name} is not in today's inventory`);
        }

        const available = inventoryItem.quantity - (inventoryItem.locked || 0);
        
        if (requestedItem.quantity > available) {
          throw new Error(
            `Insufficient stock for ${foodItem.name}. ` +
            `Requested: ${requestedItem.quantity}, Available: ${available}`
          );
        }

        // Prepare assignment item
        assignmentItems.push({
          foodItem: foodItem._id,
          name: foodItem.name,
          price: foodItem.price,
          quantityAssigned: requestedItem.quantity,
          quantityRemaining: requestedItem.quantity,
          quantitySold: 0
        });

        // Lock the items in inventory
        inventoryItem.locked = (inventoryItem.locked || 0) + requestedItem.quantity;
      }

      // 5. Create the assignment
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
        stops: route.stops?.map(stop => ({
          stopName: stop.name || stop,
          status: "pending"
        })) || [],
        status: "active",
        createdBy: supervisorId
      }], { session });

      // 6. Save inventory changes
      await inventory.save({ session });

      // 7. Commit the transaction
      await session.commitTransaction();

      // 8. Return success with assignment details
      const populatedAssignment = await DailyAssignment.findById(assignment._id)
        .populate("rider", "name email")
        .populate("vehicle", "registrationNo")
        .populate("battery", "imei")
        .populate("route", "name")
        .populate("inventory.foodItem", "name price");

      res.json({
        ok: true,
        message: "Assignment created successfully",
        assignmentId: assignment._id,
        assignment: populatedAssignment
      });

    } catch (err) {
      // If anything fails, abort the transaction
      await session.abortTransaction();
      console.error("Create assignment error:", err);
      
      // Handle specific error messages
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
 * Rider starts assignment
 */
router.post("/assignments/:id/start", auth, requireRole("rider"), async (req, res) => {
  try {
    const assignment = await DailyAssignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ error: "Assignment not found" });

    if (String(assignment.rider) !== req.user.id) {
      return res.status(403).json({ error: "Not your assignment" });
    }

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

    // Calculate sold quantities and update inventory
    const supervisorId = assignment.supervisor;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const inventory = await SupervisorInventory.findOne({
      supervisor: supervisorId,
      date: today
    }).session(session);

    if (inventory) {
      // For each item in the assignment, reduce the actual quantity by sold amount
      for (const assignedItem of assignment.inventory) {
        const soldQuantity = assignedItem.quantitySold;
        if (soldQuantity > 0) {
          const inventoryItem = inventory.items.find(
            item => String(item.foodItem) === String(assignedItem.foodItem)
          );
          
          if (inventoryItem) {
            // Reduce the actual quantity
            inventoryItem.quantity -= soldQuantity;
            // Reduce the locked quantity
            inventoryItem.locked = Math.max(0, (inventoryItem.locked || 0) - assignedItem.quantityAssigned);
          }
        }
      }
      await inventory.save({ session });
    }

    assignment.status = "completed";
    assignment.endTime = new Date();
    await assignment.save({ session });

    await session.commitTransaction();

    res.json({ 
      ok: true,
      message: "Assignment closed successfully"
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Close assignment error:", err);
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

    // Verify supervisor owns this assignment
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

export default router;