import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { SupervisorInventory } from "../models/SupervisorInventory.js";
import { FoodItem } from "../models/FoodItem.js";
import { body, validationResult } from "express-validator";

const router = express.Router();

// Validation middleware
const validateInventoryItem = [
  body("foodItemId").isMongoId().withMessage("Invalid food item ID"),
  body("quantity").isInt({ min: 1 }).withMessage("Quantity must be a positive integer"),
];

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// ==================== INVENTORY MANAGEMENT ====================

/**
 * @route   GET /api/supervisor-inventory/today
 * @desc    Get today's inventory with all items and stock status
 * @access  Private (Supervisor only)
 */
router.get("/today", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let inventory = await SupervisorInventory.findOne({
      supervisor: supervisorId,
      date: today,
    }).populate({
      path: "items.foodItem",
      select: "name price category unit minimumStock",
      populate: { path: "category", select: "name" }
    });

    if (!inventory) {
      // Create empty inventory for today
      inventory = await SupervisorInventory.create({
        supervisor: supervisorId,
        date: today,
        items: [],
        status: "draft"
      });

      inventory = await SupervisorInventory.findById(inventory._id).populate({
        path: "items.foodItem",
        select: "name price category unit minimumStock",
        populate: { path: "category", select: "name" }
      });
    }

    // Format items with calculated fields
    const items = (inventory.items || []).map((item) => {
      const available = item.quantity - (item.locked || 0);
      const lowStock = item.foodItem?.minimumStock ? 
        available <= item.foodItem.minimumStock : false;
      
      return {
        foodItem: item.foodItem?._id,
        name: item.foodItem?.name || "Unknown",
        category: item.foodItem?.category?.name || "Uncategorized",
        price: item.foodItem?.price || 0,
        unit: item.foodItem?.unit || "piece",
        quantity: item.quantity,
        locked: item.locked || 0,
        available,
        lowStock,
        status: available <= 0 ? "out_of_stock" : lowStock ? "low_stock" : "in_stock"
      };
    });

    // Group items by category for easier frontend display
    const groupedByCategory = items.reduce((acc, item) => {
      if (!acc[item.category]) {
        acc[item.category] = [];
      }
      acc[item.category].push(item);
      return acc;
    }, {});

    res.json({
      ok: true,
      inventory: {
        id: inventory._id,
        date: inventory.date,
        status: inventory.status,
        totalItems: items.length,
        totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
        totalLocked: items.reduce((sum, item) => sum + item.locked, 0),
        totalAvailable: items.reduce((sum, item) => sum + item.available, 0),
        lowStockItems: items.filter(item => item.lowStock).length,
        items,
        groupedByCategory
      }
    });
  } catch (err) {
    console.error("Get today's inventory error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * @route   POST /api/supervisor-inventory/items
 * @desc    Add new item to today's inventory
 * @access  Private (Supervisor only)
 */
router.post(
  "/items",
  auth,
  requireRole("supervisor"),
  validateInventoryItem,
  handleValidationErrors,
  async (req, res) => {
    try {
      const supervisorId = req.user.id;
      const { foodItemId, quantity, notes } = req.body;

      // Verify food item exists
      const foodItem = await FoodItem.findById(foodItemId);
      if (!foodItem) {
        return res.status(404).json({ error: "Food item not found" });
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let inventory = await SupervisorInventory.findOne({
        supervisor: supervisorId,
        date: today,
      });

      if (!inventory) {
        inventory = await SupervisorInventory.create({
          supervisor: supervisorId,
          date: today,
          items: [],
          status: "draft"
        });
      }

      // Check if item already exists
      const existingItemIndex = inventory.items.findIndex(
        (i) => String(i.foodItem) === String(foodItemId)
      );

      if (existingItemIndex > -1) {
        // Update existing item
        inventory.items[existingItemIndex].quantity += Number(quantity);
      } else {
        // Add new item
        inventory.items.push({
          foodItem: foodItemId,
          quantity: Number(quantity),
          locked: 0
        });
      }

      await inventory.save();

      res.json({
        ok: true,
        message: "Item added successfully"
      });
    } catch (err) {
      console.error("Add item error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @route   PUT /api/supervisor-inventory/items/:itemId
 * @desc    Update item quantity in today's inventory
 * @access  Private (Supervisor only)
 */
router.put(
  "/items/:itemId",
  auth,
  requireRole("supervisor"),
  [
    body("quantity").isInt({ min: 0 }).withMessage("Quantity must be a non-negative integer"),
    body("operation").isIn(["set", "add", "remove"]).withMessage("Invalid operation")
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const supervisorId = req.user.id;
      const { itemId } = req.params;
      const { quantity, operation = "set", notes } = req.body;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const inventory = await SupervisorInventory.findOne({
        supervisor: supervisorId,
        date: today,
      });

      if (!inventory) {
        return res.status(404).json({ error: "No inventory found for today" });
      }

      const itemIndex = inventory.items.findIndex(
        (i) => String(i.foodItem) === String(itemId)
      );

      if (itemIndex === -1) {
        return res.status(404).json({ error: "Item not found in inventory" });
      }

      const item = inventory.items[itemIndex];
      const available = item.quantity - item.locked;
      let newQuantity = item.quantity;

      // Calculate new quantity based on operation
      switch (operation) {
        case "set":
          if (quantity < item.locked) {
            return res.status(400).json({ 
              error: `Cannot set quantity below locked amount (${item.locked})` 
            });
          }
          newQuantity = quantity;
          break;
        case "add":
          newQuantity = item.quantity + quantity;
          break;
        case "remove":
          if (quantity > available) {
            return res.status(400).json({ 
              error: `Cannot remove ${quantity} items. Only ${available} available` 
            });
          }
          newQuantity = item.quantity - quantity;
          break;
      }

      // Update quantity
      item.quantity = newQuantity;

      // Remove item if quantity becomes 0
      if (newQuantity === 0) {
        inventory.items.splice(itemIndex, 1);
      }

      await inventory.save();

      res.json({
        ok: true,
        message: "Item updated successfully",
        item: newQuantity > 0 ? {
          foodItemId: itemId,
          quantity: newQuantity,
          locked: item.locked,
          available: newQuantity - item.locked
        } : null
      });
    } catch (err) {
      console.error("Update item error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @route   POST /api/supervisor-inventory/items/:itemId/lock
 * @desc    Lock items for pending orders
 * @access  Private (Supervisor only)
 */
router.post(
  "/items/:itemId/lock",
  auth,
  requireRole("supervisor"),
  [
    body("quantity").isInt({ min: 1 }).withMessage("Quantity must be a positive integer")
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const supervisorId = req.user.id;
      const { itemId } = req.params;
      const { quantity, orderId, notes } = req.body;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const inventory = await SupervisorInventory.findOne({
        supervisor: supervisorId,
        date: today,
      });

      if (!inventory) {
        return res.status(404).json({ error: "No inventory found for today" });
      }

      const item = inventory.items.find(
        (i) => String(i.foodItem) === String(itemId)
      );

      if (!item) {
        return res.status(404).json({ error: "Item not found in inventory" });
      }

      const available = item.quantity - item.locked;
      if (quantity > available) {
        return res.status(400).json({ 
          error: `Cannot lock ${quantity} items. Only ${available} available` 
        });
      }

      // Lock the items
      item.locked += quantity;

      await inventory.save();

      res.json({
        ok: true,
        message: "Items locked successfully",
        item: {
          foodItemId: itemId,
          quantity: item.quantity,
          locked: item.locked,
          available: item.quantity - item.locked
        }
      });
    } catch (err) {
      console.error("Lock items error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @route   POST /api/supervisor-inventory/items/:itemId/unlock
 * @desc    Unlock items (when order is cancelled)
 * @access  Private (Supervisor only)
 */
router.post(
  "/items/:itemId/unlock",
  auth,
  requireRole("supervisor"),
  [
    body("quantity").isInt({ min: 1 }).withMessage("Quantity must be a positive integer")
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const supervisorId = req.user.id;
      const { itemId } = req.params;
      const { quantity, notes } = req.body;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const inventory = await SupervisorInventory.findOne({
        supervisor: supervisorId,
        date: today,
      });

      if (!inventory) {
        return res.status(404).json({ error: "No inventory found for today" });
      }

      const item = inventory.items.find(
        (i) => String(i.foodItem) === String(itemId)
      );

      if (!item) {
        return res.status(404).json({ error: "Item not found in inventory" });
      }

      if (quantity > item.locked) {
        return res.status(400).json({ 
          error: `Cannot unlock ${quantity} items. Only ${item.locked} locked` 
        });
      }

      // Unlock the items
      item.locked -= quantity;

      await inventory.save();

      res.json({
        ok: true,
        message: "Items unlocked successfully",
        item: {
          foodItemId: itemId,
          quantity: item.quantity,
          locked: item.locked,
          available: item.quantity - item.locked
        }
      });
    } catch (err) {
      console.error("Unlock items error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @route   DELETE /api/supervisor-inventory/items/:itemId
 * @desc    Remove item from today's inventory
 * @access  Private (Supervisor only)
 */
router.delete(
  "/items/:itemId",
  auth,
  requireRole("supervisor"),
  async (req, res) => {
    try {
      const supervisorId = req.user.id;
      const { itemId } = req.params;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const inventory = await SupervisorInventory.findOne({
        supervisor: supervisorId,
        date: today,
      });

      if (!inventory) {
        return res.status(404).json({ error: "No inventory found for today" });
      }

      const itemIndex = inventory.items.findIndex(
        (i) => String(i.foodItem) === String(itemId)
      );

      if (itemIndex === -1) {
        return res.status(404).json({ error: "Item not found in inventory" });
      }

      const item = inventory.items[itemIndex];
      
      // Check if item has locked quantities
      if (item.locked > 0) {
        return res.status(400).json({ 
          error: "Cannot remove item with locked quantities. Unlock first." 
        });
      }

      // Remove the item
      inventory.items.splice(itemIndex, 1);

      await inventory.save();

      res.json({
        ok: true,
        message: "Item removed successfully"
      });
    } catch (err) {
      console.error("Remove item error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @route   POST /api/supervisor-inventory/finalize
 * @desc    Finalize today's inventory (no more changes allowed)
 * @access  Private (Supervisor only)
 */
router.post(
  "/finalize",
  auth,
  requireRole("supervisor"),
  async (req, res) => {
    try {
      const supervisorId = req.user.id;
      const { notes } = req.body;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const inventory = await SupervisorInventory.findOne({
        supervisor: supervisorId,
        date: today,
      });

      if (!inventory) {
        return res.status(404).json({ error: "No inventory found for today" });
      }

      if (inventory.status === "finalized") {
        return res.status(400).json({ error: "Inventory already finalized" });
      }

      // Validate all items have valid quantities
      const invalidItems = inventory.items.filter(
        item => item.quantity < 0 || item.locked > item.quantity
      );

      if (invalidItems.length > 0) {
        return res.status(400).json({ 
          error: "Inventory has invalid items",
          invalidItems: invalidItems.map(i => i.foodItem)
        });
      }

      inventory.status = "finalized";
      inventory.finalizedAt = new Date();
      inventory.finalizeNotes = notes;

      await inventory.save();

      res.json({
        ok: true,
        message: "Inventory finalized successfully"
      });
    } catch (err) {
      console.error("Finalize inventory error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @route   GET /api/supervisor-inventory/history
 * @desc    Get inventory history with pagination
 * @access  Private (Supervisor only)
 */
router.get("/history", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;

    // Build query
    const query = { supervisor: supervisorId };
    
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = startDate;
      if (endDate) {
        endDate.setHours(23, 59, 59, 999);
        query.date.$lte = endDate;
      }
    }

    const inventories = await SupervisorInventory.find(query)
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: "items.foodItem",
        select: "name category unit"
      });

    const total = await SupervisorInventory.countDocuments(query);

    // Format response
    const formattedInventories = inventories.map(inv => ({
      id: inv._id,
      date: inv.date,
      status: inv.status,
      itemCount: inv.items.length,
      totalQuantity: inv.items.reduce((sum, item) => sum + item.quantity, 0),
      summary: inv.items.map(item => ({
        name: item.foodItem?.name || "Unknown",
        quantity: item.quantity,
        locked: item.locked,
        available: item.quantity - item.locked
      }))
    }));

    res.json({
      ok: true,
      inventories: formattedInventories,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error("Inventory history error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;