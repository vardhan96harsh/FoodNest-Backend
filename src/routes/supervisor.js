import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { Team } from "../models/Team.js";
import { Route } from "../models/Route.js";
import { FoodItem } from "../models/FoodItem.js";
import { DailyAssignment } from "../models/DailyAssignment.js";



const router = express.Router();

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
        { path: "vehicles", select: "name registrationNo status" },
        { path: "batteries", select: "imei status type capacity" },
        {
          path: "routes",
          select: "name rider refillCoordinator",
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

      supervisors:
        team.supervisors?.map(u => ({
          id: String(u._id),
          name: u.name,
          email: u.email
        })) || [],

      riders:
        team.riders?.map(u => ({
          id: String(u._id),
          name: u.name,
          email: u.email
        })) || [],

      cooks:
        team.cooks?.map(u => ({
          id: String(u._id),
          name: u.name,
          email: u.email
        })) || [],

      refillCoordinators:
        team.refillCoordinators?.map(u => ({
          id: String(u._id),
          name: u.name,
          email: u.email
        })) || [],

      vehicles:
        team.vehicles?.map(v => ({
          id: String(v._id),
          name: v.name,
          registrationNo: v.registrationNo,
          status: v.status
        })) || [],

      batteries:
        team.batteries?.map(b => ({
          id: String(b._id),
          imei: b.imei,
          type: b.type,
          capacity: b.capacity,
          status: b.status
        })) || [],

      routes:
        team.routes?.map(r => ({
          id: String(r._id),
          name: r.name,

          rider: r.rider
            ? {
                id: String(r.rider._id),
                name: r.rider.name
              }
            : null,

          refillCoordinator: r.refillCoordinator
            ? {
                id: String(r.refillCoordinator._id),
                name: r.refillCoordinator.name
              }
            : null
        })) || []
    };

    res.json({ ok: true, team: response });

  } catch (err) {
    console.error("Supervisor my-team error:", err);
    res.status(500).json({ error: "Server error" });
  }
});
router.post(
  "/assignments/create",
  auth,
  requireRole("supervisor"),
  async (req, res) => {
    try {
      const supervisorId = req.user.id;

      const {
        routeId,
        riderId,
        vehicleId,
        batteryId,
        refillCoordinatorId,
        inventory = []
      } = req.body;

      const team = await Team.findOne({ supervisors: supervisorId });
      if (!team) {
        return res.status(404).json({ error: "Team not found" });
      }

      const route = await Route.findById(routeId);
      if (!route) {
        return res.status(404).json({ error: "Route not found" });
      }

      // ---------- FOOD VALIDATION ----------
      const foodIds = inventory.map(i => i.foodItem);
      const foods = await FoodItem.find({ _id: { $in: foodIds } }).lean();

      if (foods.length !== inventory.length) {
        return res.status(400).json({
          error: "One or more food items are invalid"
        });
      }

      // Build inventory using real food data
      const assignmentInventory = inventory.map(item => {
        const food = foods.find(f => String(f._id) === String(item.foodItem));

        return {
          foodItem: food._id,
          name: food.name,
          price: food.price,
          quantityAssigned: item.qty,
          quantityRemaining: item.qty,
          quantitySold: 0
        };
      });

      // ---------- CREATE ASSIGNMENT ----------
      const assignment = await DailyAssignment.create({
        date: new Date(),
        team: team._id,
        route: routeId,
        supervisor: supervisorId,
        rider: riderId,
        vehicle: vehicleId,
        battery: batteryId,
        refillCoordinator: refillCoordinatorId,
        inventory: assignmentInventory,
        stops: route.stops.map(s => ({
          stopName: s.name
        })),
        createdBy: supervisorId
      });

      res.json({
        ok: true,
        assignmentId: assignment._id
      });

    } catch (err) {
      console.error("Create assignment error:", err);
      res.status(500).json({ error: "Server error" });
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
 * Supervisor closes assignment
 */
router.post("/assignments/:id/close", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const assignment = await DailyAssignment.findById(req.params.id);

    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    assignment.status = "completed";
    assignment.endTime = new Date();

    await assignment.save();

    res.json({ ok: true });
  } catch (err) {
    console.error("Close assignment error:", err);
    res.status(500).json({ error: "Server error" });
  }
});
export default router;