// routes/refillRequests.js
import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import RefillRequest from "../models/RefillRequest.js";
import { DailyAssignment } from "../models/DailyAssignment.js";
import { FoodItem } from "../models/FoodItem.js";
import { User } from "../models/User.js";
import { Team } from "../models/Team.js";
import mongoose from "mongoose";

const router = express.Router();

// Helper to add history entry
const addHistory = (request, status, userId, notes = "") => {
  request.history.push({
    status,
    updatedBy: userId,
    updatedAt: new Date(),
    notes
  });
};

/**
 * GET /api/refill-requests/rider/my-requests
 * Rider: See their own refill requests
 */
router.get("/rider/my-requests", auth, requireRole("rider"), async (req, res) => {
  try {
    const requests = await RefillRequest.find({ 
      rider: req.user.id 
    })
    .populate("items.foodItem", "name price imageUrl")
    .populate("supervisor", "name")
    .populate("cook", "name")
    .populate("refillCoordinator", "name")
    .sort({ requestedAt: -1 });

    res.json({
      ok: true,
      requests
    });
  } catch (err) {
    console.error("Get rider requests error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/refill-requests/rider/create
 * Rider: Create a new refill request
 */
router.post("/rider/create", auth, requireRole("rider"), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { 
      assignmentId, 
      items, 
      reason, 
      urgency = "Medium",
      location 
    } = req.body;

    if (!items || items.length === 0) {
      throw new Error("At least one item required");
    }

    // Get rider's assignment to find supervisor
    const assignment = await DailyAssignment.findById(assignmentId)
      .populate("supervisor", "name email");

    if (!assignment) {
      throw new Error("Assignment not found");
    }

    // Get food item details
    const foodIds = items.map(i => i.foodItemId);
    const foods = await FoodItem.find({ _id: { $in: foodIds } });

    // Prepare items with details
    const requestItems = items.map(reqItem => {
      const food = foods.find(f => String(f._id) === String(reqItem.foodItemId));
      return {
        foodItem: food._id,
        name: food.name,
        quantity: reqItem.quantity,
        price: food.price,
        unit: food.unit
      };
    });

    // Create request
    const [request] = await RefillRequest.create([{
      rider: req.user.id,
      assignment: assignmentId,
      supervisor: assignment.supervisor?._id,
      items: requestItems,
      reason,
      urgency,
      riderLocation: location || null,
      status: "Pending",
      requestedAt: new Date(),
      history: [{
        status: "Pending",
        updatedBy: req.user.id,
        updatedAt: new Date(),
        notes: "Request created"
      }]
    }], { session });

    await session.commitTransaction();

    const populatedRequest = await RefillRequest.findById(request._id)
      .populate("items.foodItem", "name price imageUrl");

    res.json({
      ok: true,
      message: "Refill request created",
      request: populatedRequest
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("Create refill request error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  } finally {
    session.endSession();
  }
});

/**
 * GET /api/refill-requests/supervisor/pending
 * Supervisor: See all pending requests from their riders
 */
router.get("/supervisor/pending", auth, requireRole("supervisor"), async (req, res) => {
  try {
    // Find all riders in supervisor's team
    const team = await Team.findOne({ supervisors: req.user.id })
      .populate("riders", "_id");

    const riderIds = team?.riders?.map(r => r._id) || [];

    const requests = await RefillRequest.find({
      rider: { $in: riderIds },
      status: "Pending"
    })
    .populate("rider", "name")
    .populate("items.foodItem", "name price")
    .populate("assignment", "route")
    .sort({ urgency: -1, requestedAt: 1 });

    // Group by urgency
    const grouped = {
      critical: requests.filter(r => r.urgency === "Critical"),
      high: requests.filter(r => r.urgency === "High"),
      medium: requests.filter(r => r.urgency === "Medium"),
      low: requests.filter(r => r.urgency === "Low")
    };

    res.json({
      ok: true,
      requests,
      grouped,
      total: requests.length
    });

  } catch (err) {
    console.error("Get pending requests error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/refill-requests/supervisor/all
 * Supervisor: See all requests (history)
 */
router.get("/supervisor/all", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    
    const team = await Team.findOne({ supervisors: req.user.id })
      .populate("riders", "_id");

    const riderIds = team?.riders?.map(r => r._id) || [];
    
    const query = { rider: { $in: riderIds } };
    if (status) query.status = status;

    const requests = await RefillRequest.find(query)
      .populate("rider", "name")
      .populate("items.foodItem", "name price")
      .populate("cook", "name")
      .populate("refillCoordinator", "name")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await RefillRequest.countDocuments(query);

    res.json({
      ok: true,
      requests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (err) {
    console.error("Get all requests error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * PATCH /api/refill-requests/supervisor/:id/approve
 * Supervisor: Approve request and assign to cook
 */
router.patch("/supervisor/:id/approve", auth, requireRole("supervisor"), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { cookId, notes } = req.body;

    const request = await RefillRequest.findById(id).session(session);
    
    if (!request) {
      throw new Error("Request not found");
    }

    if (request.status !== "Pending") {
      throw new Error("Request already processed");
    }

    // Verify cook is in supervisor's team
    const team = await Team.findOne({ 
      supervisors: req.user.id,
      cooks: cookId 
    });

    if (!team && req.user.role !== "superadmin") {
      throw new Error("Cook not in your team");
    }

    request.status = "Approved";
    request.cook = cookId;
    request.supervisor = req.user.id;
    request.supervisorActionAt = new Date();
    request.supervisorNotes = notes;
    
    addHistory(request, "Approved", req.user.id, notes);

    await request.save({ session });
    await session.commitTransaction();

    const populated = await RefillRequest.findById(id)
      .populate("rider", "name")
      .populate("cook", "name")
      .populate("items.foodItem", "name price");

    res.json({
      ok: true,
      message: "Request approved and assigned to cook",
      request: populated
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("Approve request error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

/**
 * PATCH /api/refill-requests/supervisor/:id/reject
 * Supervisor: Reject request
 */
router.patch("/supervisor/:id/reject", auth, requireRole("supervisor"), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { reason } = req.body;

    const request = await RefillRequest.findById(id).session(session);
    
    if (!request) {
      throw new Error("Request not found");
    }

    if (request.status !== "Pending") {
      throw new Error("Request already processed");
    }

    request.status = "Rejected";
    request.supervisor = req.user.id;
    request.supervisorActionAt = new Date();
    request.supervisorNotes = reason;
    
    addHistory(request, "Rejected", req.user.id, reason);

    await request.save({ session });
    await session.commitTransaction();

    res.json({
      ok: true,
      message: "Request rejected",
      request
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("Reject request error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

/**
 * GET /api/refill-requests/cook/my-tasks
 * Cook: See requests assigned to them
 */
router.get("/cook/my-tasks", auth, requireRole("cook"), async (req, res) => {
  try {
    const requests = await RefillRequest.find({
      cook: req.user.id,
      status: { $in: ["Approved", "CookPreparing"] }
    })
    .populate("rider", "name")
    .populate("supervisor", "name")
    .populate("items.foodItem", "name price")
    .sort({ urgency: -1, createdAt: 1 });

    res.json({
      ok: true,
      requests,
      total: requests.length
    });

  } catch (err) {
    console.error("Get cook tasks error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * PATCH /api/refill-requests/cook/:id/start-preparing
 * Cook: Start preparing the items
 */
router.patch("/cook/:id/start-preparing", auth, requireRole("cook"), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { notes } = req.body;

    const request = await RefillRequest.findById(id).session(session);
    
    if (!request) {
      throw new Error("Request not found");
    }

    if (request.status !== "Approved") {
      throw new Error("Request not approved yet");
    }

    if (String(request.cook) !== String(req.user.id)) {
      throw new Error("Not assigned to you");
    }

    request.status = "CookPreparing";
    request.cookStartedAt = new Date();
    request.cookNotes = notes;
    
    addHistory(request, "CookPreparing", req.user.id, notes);

    await request.save({ session });
    await session.commitTransaction();

    res.json({
      ok: true,
      message: "Started preparing",
      request
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("Start preparing error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

/**
 * PATCH /api/refill-requests/cook/:id/complete
 * Cook: Mark as ready for pickup
 */
router.patch("/cook/:id/complete", auth, requireRole("cook"), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { notes } = req.body;

    const request = await RefillRequest.findById(id).session(session);
    
    if (!request) {
      throw new Error("Request not found");
    }

    if (request.status !== "CookPreparing") {
      throw new Error("Not in preparation");
    }

    if (String(request.cook) !== String(req.user.id)) {
      throw new Error("Not assigned to you");
    }

    request.status = "ReadyForPickup";
    request.cookCompletedAt = new Date();
    request.cookNotes = notes;
    
    addHistory(request, "ReadyForPickup", req.user.id, notes);

    await request.save({ session });
    await session.commitTransaction();

    res.json({
      ok: true,
      message: "Ready for pickup",
      request
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("Complete preparation error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

/**
 * GET /api/refill-requests/refill/my-deliveries
 * Refill Coordinator: See ready items for delivery
 */
router.get("/refill/my-deliveries", auth, requireRole("refillCoordinator"), async (req, res) => {
  try {
    // Find requests that are ready for pickup or assigned to this refill coordinator
    const requests = await RefillRequest.find({
      $or: [
        { status: "ReadyForPickup" },
        { 
          refillCoordinator: req.user.id,
          status: { $in: ["AssignedToRefill", "OutForDelivery"] }
        }
      ]
    })
    .populate("rider", "name")
    .populate("assignment", "route")
    .populate("items.foodItem", "name price")
    .sort({ createdAt: 1 });

    // Separate into groups
    const ready = requests.filter(r => r.status === "ReadyForPickup");
    const assigned = requests.filter(r => r.status === "AssignedToRefill");
    const outForDelivery = requests.filter(r => r.status === "OutForDelivery");

    res.json({
      ok: true,
      ready,
      assigned,
      outForDelivery,
      total: requests.length
    });

  } catch (err) {
    console.error("Get refill deliveries error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * PATCH /api/refill-requests/refill/:id/assign-to-me
 * Refill Coordinator: Assign request to themselves
 */
router.patch("/refill/:id/assign-to-me", auth, requireRole("refillCoordinator"), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { notes } = req.body;

    const request = await RefillRequest.findById(id).session(session);
    
    if (!request) {
      throw new Error("Request not found");
    }

    if (request.status !== "ReadyForPickup") {
      throw new Error("Not ready for pickup");
    }

    request.status = "AssignedToRefill";
    request.refillCoordinator = req.user.id;
    request.refillAssignedAt = new Date();
    request.refillNotes = notes;
    
    addHistory(request, "AssignedToRefill", req.user.id, notes);

    await request.save({ session });
    await session.commitTransaction();

    res.json({
      ok: true,
      message: "Request assigned to you",
      request
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("Assign to refill error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

/**
 * PATCH /api/refill-requests/refill/:id/start-delivery
 * Refill Coordinator: Start delivery to rider
 */
router.patch("/refill/:id/start-delivery", auth, requireRole("refillCoordinator"), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { notes } = req.body;

    const request = await RefillRequest.findById(id).session(session);
    
    if (!request) {
      throw new Error("Request not found");
    }

    if (request.status !== "AssignedToRefill") {
      throw new Error("Not assigned to you yet");
    }

    if (String(request.refillCoordinator) !== String(req.user.id)) {
      throw new Error("Not assigned to you");
    }

    request.status = "OutForDelivery";
    request.refillStartedAt = new Date();
    request.refillNotes = notes;
    
    addHistory(request, "OutForDelivery", req.user.id, notes);

    await request.save({ session });
    await session.commitTransaction();

    res.json({
      ok: true,
      message: "Delivery started",
      request
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("Start delivery error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

/**
 * PATCH /api/refill-requests/refill/:id/delivered
 * Refill Coordinator: Mark as delivered to rider
 */
router.patch("/refill/:id/delivered", auth, requireRole("refillCoordinator"), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { notes, location } = req.body;

    const request = await RefillRequest.findById(id).session(session);
    
    if (!request) {
      throw new Error("Request not found");
    }

    if (request.status !== "OutForDelivery") {
      throw new Error("Not out for delivery");
    }

    if (String(request.refillCoordinator) !== String(req.user.id)) {
      throw new Error("Not assigned to you");
    }

    request.status = "Delivered";
    request.deliveredAt = new Date();
    request.refillNotes = notes;
    request.riderLocation = location || request.riderLocation;
    
    addHistory(request, "Delivered", req.user.id, notes);

    await request.save({ session });
    await session.commitTransaction();

    res.json({
      ok: true,
      message: "Delivered to rider",
      request
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("Delivered error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

/**
 * GET /api/refill-requests/:id/track
 * Anyone involved: Track request status
 */
router.get("/:id/track", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const request = await RefillRequest.findById(id)
      .populate("rider", "name")
      .populate("supervisor", "name")
      .populate("cook", "name")
      .populate("refillCoordinator", "name")
      .populate("items.foodItem", "name price imageUrl");

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    // Check if user is involved
    const isInvolved = [
      request.rider?._id,
      request.supervisor?._id,
      request.cook?._id,
      request.refillCoordinator?._id
    ].some(id => id && String(id) === String(userId));

    if (!isInvolved && req.user.role !== "superadmin") {
      return res.status(403).json({ error: "Not authorized" });
    }

    res.json({
      ok: true,
      request
    });

  } catch (err) {
    console.error("Track request error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;