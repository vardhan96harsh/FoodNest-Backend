import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { PrepTask } from "../models/PrepTask.js";
import { FoodItem } from "../models/FoodItem.js";
import { User } from "../models/User.js";
import { Team } from "../models/Team.js";
import mongoose from "mongoose";

const router = express.Router();

// Helper to add history entry
const addHistory = (task, status, userId, notes = "") => {
  if (!task.history) task.history = [];
  task.history.push({
    status,
    updatedBy: userId,
    updatedAt: new Date(),
    notes
  });
};

// ==================== TEST ROUTE ====================
router.get("/test", (req, res) => {
  console.log("✅ Test route hit!");
  res.json({ ok: true, message: "Prep tasks router is working!" });
});

// ==================== SUPERVISOR ROUTES ====================

/**
 * GET /api/prep-tasks/supervisor/tasks
 * Supervisor: Get all prep tasks for their team
 */
router.get("/supervisor/tasks", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const { date, status, cookId } = req.query;
    
    console.log("🔍 Fetching prep tasks for supervisor:", req.user.id);
    
    // Find the team where this user is a supervisor
    const team = await Team.findOne({ supervisors: req.user.id });
    
    if (!team) {
      console.log("⚠️ No team found for supervisor:", req.user.id);
      return res.json({ 
        tasks: [], 
        total: 0, 
        cooks: [],
        summary: {
          assigned: 0,
          accepted: 0,
          preparing: 0,
          completed: 0,
          total: 0
        }
      });
    }
    
    console.log("✅ Found team:", team.name);
    console.log("Team cooks IDs:", team.cooks);
    
    // Build query
    const query = { 
      supervisor: req.user.id,
      team: team._id
    };
    
    // Filter by date (default to today)
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);
    query.scheduledDate = { $gte: targetDate, $lt: nextDay };
    
    if (status && status !== "all") query.status = status;
    if (cookId) query.cook = cookId;
    
    const tasks = await PrepTask.find(query)
      .populate("cook", "name email")
      .populate("supervisor", "name email")
      .populate("items.foodItem", "name price unit")
      .sort({ priority: -1, createdAt: -1 });
    
    console.log(`📋 Found ${tasks.length} prep tasks`);
    
    // Get team cooks for filter
    let cooks = [];
    if (team.cooks && team.cooks.length > 0) {
      cooks = await User.find(
        { _id: { $in: team.cooks }, role: "cook" },
        "name email"
      );
    }
    
    console.log(`👨‍🍳 Found ${cooks.length} cooks in team`);
    
    // Calculate summary
    const summary = {
      assigned: tasks.filter(t => t.status === "Assigned").length,
      accepted: tasks.filter(t => t.status === "Accepted").length,
      preparing: tasks.filter(t => t.status === "Preparing").length,
      completed: tasks.filter(t => t.status === "Completed").length,
      total: tasks.length
    };
    
    res.json({ 
      ok: true, 
      tasks, 
      cooks,
      summary 
    });
    
  } catch (err) {
    console.error("Get prep tasks error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

/**
 * POST /api/prep-tasks/supervisor/create
 * Supervisor: Create a new prep task
 */
/**
 * POST /api/prep-tasks/supervisor/create
 * Supervisor: Create a new prep task
 */
router.post("/supervisor/create", auth, requireRole("supervisor"), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const {
      cookId,
      items,
      scheduledDate,
      scheduledTime = "Morning",
      deadline,
      priority = "Medium",
      isUrgent = false,
      supervisorNotes = ""
    } = req.body;
    
    console.log("📝 Creating prep task for cook:", cookId);
    console.log("Items:", JSON.stringify(items, null, 2));
    
    // Validation
    if (!cookId) throw new Error("Cook ID required");
    if (!items || items.length === 0) throw new Error("At least one item required");
    
    // Get team
    const team = await Team.findOne({ supervisors: req.user.id }).session(session);
    if (!team) throw new Error("No team found");
    
    console.log("👥 Team found:", team.name);
    
    // Verify cook in team
    const isCookInTeam = team.cooks && team.cooks.some(c => String(c) === String(cookId));
    
    if (!isCookInTeam) {
      console.log(`❌ Cook ${cookId} not found in team cooks:`, team.cooks);
      throw new Error("Cook not in your team");
    }
    
    const cook = await User.findById(cookId).session(session);
    if (!cook || cook.role !== "cook") throw new Error("Invalid cook");
    
    console.log("✅ Cook verified:", cook.name);
    
    // Get food items
    const foodIds = items.map(i => i.foodItemId);
    const foods = await FoodItem.find({ _id: { $in: foodIds } }).session(session);
    
    // Prepare items
    const taskItems = items.map(reqItem => {
      const food = foods.find(f => String(f._id) === String(reqItem.foodItemId));
      if (!food) throw new Error(`Food item not found: ${reqItem.foodItemId}`);
      return {
        foodItem: food._id,
        name: food.name,
        quantity: reqItem.quantity,
        unit: food.unit || "piece",
        completed: false,
        completedQuantity: 0
      };
    });
    
    // Set dates
    const scheduledDateObj = scheduledDate ? new Date(scheduledDate) : new Date();
    scheduledDateObj.setHours(0, 0, 0, 0);
    
    const deadlineObj = deadline ? new Date(deadline) : new Date(scheduledDateObj);
    if (!deadline) deadlineObj.setHours(10, 0, 0, 0);
    
    // Create task
    const task = new PrepTask({
      supervisor: req.user.id,
      cook: cookId,
      team: team._id,
      items: taskItems,
      scheduledDate: scheduledDateObj,
      scheduledTime,
      deadline: deadlineObj,
      priority,
      isUrgent,
      supervisorNotes,
      status: "Assigned",
      assignedAt: new Date(),
      history: []
    });
    
    // Add history entry
    if (!task.history) task.history = [];
    task.history.push({
      status: "Assigned",
      updatedBy: req.user.id,
      updatedAt: new Date(),
      notes: `Task assigned to ${cook.name}`
    });
    
    console.log("Saving task...");
    await task.save({ session });
    await session.commitTransaction();
    
    console.log("✅ Task created successfully with ID:", task._id);
    console.log("Task number:", task.taskNumber);
    
    const populatedTask = await PrepTask.findById(task._id)
      .populate("cook", "name email")
      .populate("items.foodItem", "name price unit");
    
    res.json({ ok: true, message: "Prep task created", task: populatedTask });
    
  } catch (err) {
    await session.abortTransaction();
    console.error("❌ Create prep task error:", err);
    console.error("Error stack:", err.stack);
    
    // Send detailed error
    if (err.name === 'ValidationError') {
      return res.status(400).json({ 
        error: "Validation error", 
        details: err.message,
        fields: Object.keys(err.errors).map(f => ({ 
          field: f, 
          message: err.errors[f].message 
        }))
      });
    }
    
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});
/**
 * PATCH /api/prep-tasks/supervisor/:id/cancel
 * Supervisor: Cancel a task
 */
router.patch("/supervisor/:id/cancel", auth, requireRole("supervisor"), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    const task = await PrepTask.findById(id).session(session);
    if (!task) throw new Error("Task not found");
    if (String(task.supervisor) !== String(req.user.id)) throw new Error("Not authorized");
    if (task.status === "Completed") throw new Error("Cannot cancel completed task");
    
    task.status = "Cancelled";
    task.cancelledAt = new Date();
    addHistory(task, "Cancelled", req.user.id, reason || "Cancelled by supervisor");
    
    await task.save({ session });
    await session.commitTransaction();
    
    res.json({ ok: true, message: "Task cancelled" });
    
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

// ==================== COOK ROUTES ====================

/**
 * GET /api/prep-tasks/cook/tasks
 * Cook: Get their assigned tasks
 */
router.get("/cook/tasks", auth, requireRole("cook"), async (req, res) => {
  try {
    const { status, date } = req.query;
    
    console.log("🔍 Fetching tasks for cook:", req.user.id);
    
    const query = { 
      cook: req.user.id,
      status: { $ne: "Cancelled" }
    };
    
    // Filter by date (default today)
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);
    query.scheduledDate = { $gte: targetDate, $lt: nextDay };
    
    if (status && status !== "all") query.status = status;
    
    const tasks = await PrepTask.find(query)
      .populate("supervisor", "name email")
      .populate("items.foodItem", "name price unit")
      .sort({ priority: -1, deadline: 1 });
    
    console.log(`📋 Found ${tasks.length} tasks for cook`);
    
    const summary = {
      assigned: tasks.filter(t => t.status === "Assigned").length,
      accepted: tasks.filter(t => t.status === "Accepted").length,
      preparing: tasks.filter(t => t.status === "Preparing").length,
      completed: tasks.filter(t => t.status === "Completed").length
    };
    
    res.json({ ok: true, tasks, summary });
    
  } catch (err) {
    console.error("Get cook tasks error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * PATCH /api/prep-tasks/cook/:id/accept
 * Cook: Accept a task
 */
router.patch("/cook/:id/accept", auth, requireRole("cook"), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { id } = req.params;
    const { notes } = req.body;
    
    const task = await PrepTask.findById(id).session(session);
    if (!task) throw new Error("Task not found");
    if (String(task.cook) !== String(req.user.id)) throw new Error("Not assigned to you");
    if (task.status !== "Assigned") throw new Error("Task already processed");
    
    task.status = "Accepted";
    task.acceptedAt = new Date();
    addHistory(task, "Accepted", req.user.id, notes || "Task accepted");
    
    await task.save({ session });
    await session.commitTransaction();
    
    res.json({ ok: true, message: "Task accepted", task });
    
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

/**
 * PATCH /api/prep-tasks/cook/:id/start
 * Cook: Start preparing
 */
router.patch("/cook/:id/start", auth, requireRole("cook"), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { id } = req.params;
    const { notes } = req.body;
    
    const task = await PrepTask.findById(id).session(session);
    if (!task) throw new Error("Task not found");
    if (String(task.cook) !== String(req.user.id)) throw new Error("Not assigned to you");
    if (task.status !== "Accepted") throw new Error("Must accept task first");
    
    task.status = "Preparing";
    task.startedAt = new Date();
    addHistory(task, "Preparing", req.user.id, notes || "Started preparation");
    
    await task.save({ session });
    await session.commitTransaction();
    
    res.json({ ok: true, message: "Started preparing", task });
    
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

/**
 * PATCH /api/prep-tasks/cook/:id/complete
 * Cook: Complete task
 */
router.patch("/cook/:id/complete", auth, requireRole("cook"), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { id } = req.params;
    const { notes } = req.body;
    
    console.log("🔵 Complete task request for ID:", id);
    console.log("User ID:", req.user.id);
    
    const task = await PrepTask.findById(id).session(session);
    
    if (!task) {
      console.log("❌ Task not found");
      return res.status(404).json({ error: "Task not found" });
    }
    
    console.log("Task found:", {
      id: task._id,
      cook: task.cook,
      currentUser: req.user.id,
      status: task.status,
      isSameCook: String(task.cook) === String(req.user.id)
    });
    
    // Check authorization
    if (String(task.cook) !== String(req.user.id)) {
      console.log("❌ Not assigned to this cook");
      return res.status(403).json({ error: "Not assigned to you" });
    }
    
    // Check if task can be completed
    if (task.status !== "Preparing") {
      console.log(`❌ Wrong status: ${task.status}, expected "Preparing"`);
      return res.status(400).json({ 
        error: `Task must be in "Preparing" status to complete. Current status: ${task.status}`,
        currentStatus: task.status,
        validStatuses: ["Preparing"]
      });
    }
    
    // Check if all items are fully completed
    const allItemsCompleted = task.items.every(item => 
      item.completedQuantity >= item.quantity
    );
    
    console.log("All items completed check:", allItemsCompleted);
    console.log("Item details:", task.items.map(item => ({
      name: item.name,
      required: item.quantity,
      completed: item.completedQuantity,
      isCompleted: item.completedQuantity >= item.quantity
    })));
    
    if (!allItemsCompleted) {
      const incompleteItems = task.items
        .filter(item => item.completedQuantity < item.quantity)
        .map(item => ({
          name: item.name,
          required: item.quantity,
          completed: item.completedQuantity,
          missing: item.quantity - item.completedQuantity,
          unit: item.unit
        }));
      
      console.log("❌ Cannot complete - items not fully prepared:", incompleteItems);
      
      return res.status(400).json({ 
        error: "Cannot complete task. Not all items are fully prepared.",
        items: incompleteItems
      });
    }
    
    // Mark all items as completed
    task.items.forEach(item => {
      console.log(`✅ Marking item ${item.name} as completed`);
      item.completed = true;
      item.completedQuantity = item.quantity;
    });
    
    task.status = "Completed";
    task.completedAt = new Date();
    
    // Add to history
    if (!task.history) task.history = [];
    task.history.push({
      status: "Completed",
      updatedBy: req.user.id,
      updatedAt: new Date(),
      notes: notes || "Task completed"
    });
    
    await task.save({ session });
    await session.commitTransaction();
    
    console.log("✅ Task completed successfully!");
    
    // Return populated task
    const populatedTask = await PrepTask.findById(id)
      .populate("cook", "name email")
      .populate("supervisor", "name email")
      .populate("items.foodItem", "name price unit");
    
    res.json({ 
      ok: true, 
      message: "Task completed", 
      task: populatedTask 
    });
    
  } catch (err) {
    await session.abortTransaction();
    console.error("❌ Complete task error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

/**
 * PATCH /api/prep-tasks/cook/:id/progress
 * Cook: Update item progress
 */
router.patch("/cook/:id/progress", auth, requireRole("cook"), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { id } = req.params;
    const { itemProgress, notes } = req.body;
    
    const task = await PrepTask.findById(id).session(session);
    if (!task) throw new Error("Task not found");
    if (String(task.cook) !== String(req.user.id)) throw new Error("Not assigned to you");
    if (task.status !== "Preparing") throw new Error("Can only update during preparation");
    
    if (itemProgress && Array.isArray(itemProgress)) {
      itemProgress.forEach(progress => {
        const item = task.items.find(i => String(i.foodItem) === String(progress.foodItemId));
        if (item) {
          item.completedQuantity = progress.completedQuantity;
          item.completed = item.completedQuantity >= item.quantity;
        }
      });
    }
    
    if (notes) task.cookNotes = notes;
    await task.save({ session });
    await session.commitTransaction();
    
    res.json({ ok: true, message: "Progress updated", task });
    
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

// ==================== TRACKING ROUTE ====================

/**
 * GET /api/prep-tasks/:id/track
 * Track task status (both roles)
 */
router.get("/:id/track", auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const task = await PrepTask.findById(id)
      .populate("cook", "name email")
      .populate("supervisor", "name email")
      .populate("items.foodItem", "name price unit");
    
    if (!task) return res.status(404).json({ error: "Task not found" });
    
    const isAuthorized = 
      String(task.cook._id) === String(req.user.id) ||
      String(task.supervisor._id) === String(req.user.id) ||
      req.user.role === "superadmin";
    
    if (!isAuthorized) {
      return res.status(403).json({ error: "Not authorized" });
    }
    
    // Calculate progress
    const totalItems = task.items.reduce((sum, i) => sum + i.quantity, 0);
    const completedItems = task.items.reduce((sum, i) => sum + i.completedQuantity, 0);
    const progress = totalItems > 0 ? (completedItems / totalItems) * 100 : 0;
    
    const timeRemaining = task.deadline 
      ? Math.max(0, (task.deadline.getTime() - new Date().getTime()) / (1000 * 60))
      : null;
    
    res.json({
      ok: true,
      task,
      tracking: {
        status: task.status,
        progress,
        timeRemaining: Math.round(timeRemaining),
        estimatedCompletion: task.deadline
      }
    });
    
  } catch (err) {
    console.error("Track task error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

console.log("✅ Prep tasks router loaded successfully");

export default router;