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

// ==================== TODAY'S INVENTORY (TEMPORARY ITEMS) ====================

/**
 * @route   GET /api/supervisor-inventory/today
 * @desc    Get today's inventory (temporary items for daily service)
 * @access  Private (Supervisor only)
 */
router.get("/today", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let inventory = await SupervisorInventory.findOne({
      supervisor: supervisorId,
      date: today
    }).populate({
      path: "items.foodItem",
      select: "name price category unit minimumStock isPermanent description",
      populate: { path: "category", select: "name description" }
    });

    if (!inventory) {
      // Create default inventory for today if doesn't exist
      inventory = await SupervisorInventory.create({
        supervisor: supervisorId,
        date: today,
        items: [],
        status: "draft",
        isActive: true
      });

      inventory = await SupervisorInventory.findById(inventory._id).populate({
        path: "items.foodItem",
        select: "name price category unit minimumStock isPermanent description",
        populate: { path: "category", select: "name description" }
      });
    }

    // Filter only temporary items (not permanent) that are active
    const temporaryItems = (inventory.items || [])
      .filter(item => !item.foodItem?.isPermanent && item.status === "active")
      .map(item => {
        const available = item.quantity - (item.locked || 0);
        const lowStock = item.foodItem?.minimumStock ? 
          available <= item.foodItem.minimumStock : false;
        
        return {
          foodItem: item.foodItem?._id,
          name: item.foodItem?.name || "Unknown",
          price: item.foodItem?.price || 0,
          category: item.foodItem?.category?.name || "Uncategorized",
          unit: item.foodItem?.unit || "piece",
          quantity: item.quantity,
          locked: item.locked || 0,
          available,
          lowStock,
          isPermanent: false,
          status: available <= 0 ? "out_of_stock" : lowStock ? "low_stock" : "in_stock"
        };
      });

    const totalQuantity = temporaryItems.reduce((sum, item) => sum + item.quantity, 0);
    const totalAvailable = temporaryItems.reduce((sum, item) => sum + item.available, 0);
    const totalLocked = temporaryItems.reduce((sum, item) => sum + item.locked, 0);

    res.json({
      ok: true,
      inventory: {
        id: inventory._id,
        date: inventory.date,
        status: inventory.status,
        items: temporaryItems,
        totalItems: temporaryItems.length,
        totalQuantity: totalQuantity,
        totalLocked: totalLocked,
        totalAvailable: totalAvailable,
        lowStockItems: temporaryItems.filter(item => item.lowStock).length
      }
    });
  } catch (err) {
    console.error("Get today's inventory error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * @route   POST /api/supervisor-inventory/items
 * @desc    Add item to today's inventory
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
      const { foodItemId, quantity, notes, isManualRestock = false } = req.body;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Verify food item exists and is not permanent
      const foodItem = await FoodItem.findById(foodItemId);
      if (!foodItem) {
        return res.status(404).json({ error: "Food item not found" });
      }

      if (foodItem.isPermanent) {
        return res.status(400).json({ error: "Permanent items cannot be added to daily inventory" });
      }

      let inventory = await SupervisorInventory.findOne({
        supervisor: supervisorId,
        date: today
      });

      if (!inventory) {
        inventory = await SupervisorInventory.create({
          supervisor: supervisorId,
          date: today,
          items: [],
          status: "draft",
          isActive: true
        });
      }

      const quantityNum = Number(quantity);
      
      // Check if item already exists
      const existingItemIndex = inventory.items.findIndex(
        (i) => String(i.foodItem) === String(foodItemId)
      );

      if (existingItemIndex > -1) {
        const existingItem = inventory.items[existingItemIndex];
        
        // If item was finished, reactivate it
        if (existingItem.status === "finished") {
          existingItem.status = "active";
        }
        
        existingItem.quantity += quantityNum;
        existingItem.lastRestockedAt = new Date();
        
        if (isManualRestock) {
          existingItem.manualRestocked = (existingItem.manualRestocked || 0) + quantityNum;
        }
      } else {
        // Add new item
        inventory.items.push({
          foodItem: foodItemId,
          quantity: quantityNum,
          locked: 0,
          manualRestocked: isManualRestock ? quantityNum : 0,
          lastRestockedAt: new Date(),
          status: "active"
        });
      }

      await inventory.save();

      // Fetch updated item with populated data
      const updatedInventory = await SupervisorInventory.findById(inventory._id).populate({
        path: "items.foodItem",
        select: "name price category unit minimumStock"
      });
      
      const updatedItem = updatedInventory.items.find(
        i => String(i.foodItem._id) === String(foodItemId)
      );

      res.json({
        ok: true,
        message: "Item added to daily inventory successfully",
        item: {
          foodItemId,
          name: updatedItem?.foodItem?.name,
          quantity: updatedItem?.quantity,
          manualRestocked: updatedItem?.manualRestocked,
          lastRestockedAt: updatedItem?.lastRestockedAt
        }
      });
    } catch (err) {
      console.error("Add item error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// ==================== PERMANENT INVENTORY MANAGEMENT ====================

/**
 * @route   GET /api/supervisor-inventory
 * @desc    Get supervisor's permanent inventory with all items and stock status
 * @access  Private (Supervisor only)
 */
router.get("/", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const supervisorId = req.user.id;

    let inventory = await SupervisorInventory.findOne({
      supervisor: supervisorId,
    }).populate({
      path: "items.foodItem",
      select: "name price category unit minimumStock description isPermanent",
      populate: { path: "category", select: "name description" }
    });

    if (!inventory) {
      // Create permanent inventory for supervisor if doesn't exist
      inventory = await SupervisorInventory.create({
        supervisor: supervisorId,
        items: [],
        isActive: true
      });

      inventory = await SupervisorInventory.findById(inventory._id).populate({
        path: "items.foodItem",
        select: "name price category unit minimumStock description isPermanent",
        populate: { path: "category", select: "name description" }
      });
    }

    // Filter active items only
    const activeItems = (inventory.items || []).filter(item => item.status === "active");
    const finishedItems = (inventory.items || []).filter(item => item.status === "finished");

    // Format items with calculated fields
    const formattedItems = activeItems.map((item) => {
      const available = item.quantity - (item.locked || 0);
      const lowStock = item.foodItem?.minimumStock ? 
        available <= item.foodItem.minimumStock : false;
      
      return {
        id: item._id,
        foodItem: item.foodItem?._id,
        name: item.foodItem?.name || "Unknown",
        category: item.foodItem?.category?.name || "Uncategorized",
        price: item.foodItem?.price || 0,
        unit: item.foodItem?.unit || "piece",
        minimumStock: item.foodItem?.minimumStock || 0,
        quantity: item.quantity,
        locked: item.locked || 0,
        available,
        manualRestocked: item.manualRestocked,
        lastRestockedAt: item.lastRestockedAt,
        lowStock,
        isPermanent: item.foodItem?.isPermanent || false,
        status: available <= 0 ? "out_of_stock" : lowStock ? "low_stock" : "in_stock",
        stockPercentage: item.quantity > 0 ? Math.min(100, Math.round((available / item.quantity) * 100)) : 0
      };
    });

    // Group items by category
    const groupedByCategory = formattedItems.reduce((acc, item) => {
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
        supervisor: inventory.supervisor,
        isActive: inventory.isActive,
        notes: inventory.notes,
        totalItems: activeItems.length,
        finishedItems: finishedItems.length,
        totalQuantity: activeItems.reduce((sum, item) => sum + item.quantity, 0),
        totalLocked: activeItems.reduce((sum, item) => sum + (item.locked || 0), 0),
        totalAvailable: activeItems.reduce((sum, item) => sum + (item.quantity - (item.locked || 0)), 0),
        lowStockItems: formattedItems.filter(item => item.lowStock).length,
        outOfStockItems: formattedItems.filter(item => item.available <= 0).length,
        items: formattedItems,
        groupedByCategory,
        finishedItemsList: finishedItems.map(item => ({
          foodItem: item.foodItem?._id,
          name: item.foodItem?.name || "Unknown",
          quantity: item.quantity,
          finishedAt: item.updatedAt
        }))
      }
    });
  } catch (err) {
    console.error("Get inventory error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * @route   GET /api/supervisor-inventory/permanent-stock
 * @desc    Get permanent stock items (active items with isPermanent=true)
 * @access  Private (Supervisor only)
 */
router.get("/permanent-stock", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const supervisorId = req.user.id;

    let inventory = await SupervisorInventory.findOne({
      supervisor: supervisorId,
    }).populate({
      path: "items.foodItem",
      select: "name price category unit minimumStock isPermanent description",
      populate: { path: "category", select: "name description" }
    });

    if (!inventory) {
      return res.json({
        ok: true,
        inventory: {
          items: [],
          totalItems: 0,
          totalQuantity: 0
        }
      });
    }

    // Filter only permanent items that are active
    const permanentItems = (inventory.items || [])
      .filter(item => item.foodItem?.isPermanent === true && item.status === "active")
      .map(item => {
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
          isPermanent: true,
          lastRestocked: item.lastRestockedAt,
          status: available <= 0 ? "out_of_stock" : lowStock ? "low_stock" : "in_stock"
        };
      });

    const totalQuantity = permanentItems.reduce((sum, item) => sum + item.quantity, 0);
    const totalAvailable = permanentItems.reduce((sum, item) => sum + item.available, 0);
    const totalLocked = permanentItems.reduce((sum, item) => sum + item.locked, 0);

    res.json({
      ok: true,
      inventory: {
        items: permanentItems,
        totalItems: permanentItems.length,
        totalQuantity: totalQuantity,
        totalAvailable: totalAvailable,
        totalLocked: totalLocked,
        lowStockItems: permanentItems.filter(item => item.lowStock).length
      }
    });
  } catch (err) {
    console.error("Get permanent stock error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * @route   POST /api/supervisor-inventory/permanent-stock/restock
 * @desc    Restock multiple permanent items at once
 * @access  Private (Supervisor only)
 */
router.post(
  "/permanent-stock/restock",
  auth,
  requireRole("supervisor"),
  [
    body("items").isArray().withMessage("Items array required"),
    body("items.*.foodItemId").isMongoId().withMessage("Valid food item ID required"),
    body("items.*.quantity").isInt({ min: 1 }).withMessage("Quantity must be positive")
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const supervisorId = req.user.id;
      const { items, notes } = req.body;

      let inventory = await SupervisorInventory.findOne({
        supervisor: supervisorId,
      });

      if (!inventory) {
        inventory = await SupervisorInventory.create({
          supervisor: supervisorId,
          items: [],
          isActive: true
        });
      }

      const results = [];

      for (const restockItem of items) {
        const { foodItemId, quantity } = restockItem;
        const quantityNum = Number(quantity);

        // Verify food item exists and is permanent
        const foodItem = await FoodItem.findById(foodItemId);
        if (!foodItem) {
          results.push({ foodItemId, success: false, error: "Food item not found" });
          continue;
        }

        if (!foodItem.isPermanent) {
          results.push({ foodItemId, success: false, error: "Item is not permanent" });
          continue;
        }

        const existingItemIndex = inventory.items.findIndex(
          (i) => String(i.foodItem) === String(foodItemId)
        );

        if (existingItemIndex > -1) {
          const existingItem = inventory.items[existingItemIndex];
          
          if (existingItem.status === "finished") {
            existingItem.status = "active";
          }
          
          existingItem.quantity += quantityNum;
          existingItem.lastRestockedAt = new Date();
          existingItem.manualRestocked = (existingItem.manualRestocked || 0) + quantityNum;
          
          results.push({
            foodItemId,
            success: true,
            name: foodItem.name,
            newQuantity: existingItem.quantity
          });
        } else {
          inventory.items.push({
            foodItem: foodItemId,
            quantity: quantityNum,
            locked: 0,
            manualRestocked: quantityNum,
            lastRestockedAt: new Date(),
            status: "active"
          });
          
          results.push({
            foodItemId,
            success: true,
            name: foodItem.name,
            newQuantity: quantityNum
          });
        }
      }

      await inventory.save();

      res.json({
        ok: true,
        message: `Restocked ${results.filter(r => r.success).length} items successfully`,
        results
      });
    } catch (err) {
      console.error("Restock error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @route   PUT /api/supervisor-inventory/items/:itemId
 * @desc    Update item quantity in permanent inventory
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
      const { quantity, operation = "set", notes, isManualRestock = false } = req.body;
      const quantityNum = Number(quantity);

      const inventory = await SupervisorInventory.findOne({
        supervisor: supervisorId,
      });

      if (!inventory) {
        return res.status(404).json({ error: "No inventory found" });
      }

      const itemIndex = inventory.items.findIndex(
        (i) => String(i.foodItem) === String(itemId)
      );

      if (itemIndex === -1) {
        return res.status(404).json({ error: "Item not found in inventory" });
      }

      const item = inventory.items[itemIndex];
      
      // Check if item is finished
      if (item.status === "finished") {
        return res.status(400).json({ error: "Cannot update finished item" });
      }
      
      const available = item.quantity - (item.locked || 0);
      let newQuantity = item.quantity;
      let quantityChanged = 0;

      // Calculate new quantity based on operation
      switch (operation) {
        case "set":
          if (quantityNum < (item.locked || 0)) {
            return res.status(400).json({ 
              error: `Cannot set quantity below locked amount (${item.locked})` 
            });
          }
          quantityChanged = quantityNum - item.quantity;
          newQuantity = quantityNum;
          break;
        case "add":
          quantityChanged = quantityNum;
          newQuantity = item.quantity + quantityNum;
          break;
        case "remove":
          if (quantityNum > available) {
            return res.status(400).json({ 
              error: `Cannot remove ${quantityNum} items. Only ${available} available` 
            });
          }
          quantityChanged = -quantityNum;
          newQuantity = item.quantity - quantityNum;
          break;
      }

      // Update quantity
      item.quantity = newQuantity;
      
      // Update status if quantity becomes 0
      if (newQuantity === 0) {
        item.status = "finished";
      } else if (item.status === "finished") {
        item.status = "active";
      }
      
      // Track manual restock if applicable (only for positive additions)
      if (isManualRestock && quantityChanged > 0) {
        item.manualRestocked = (item.manualRestocked || 0) + quantityChanged;
        item.lastRestockedAt = new Date();
      }

      await inventory.save();

      const populatedInventory = await SupervisorInventory.findById(inventory._id).populate({
        path: "items.foodItem",
        select: "name unit minimumStock isPermanent"
      });
      
      const updatedItem = populatedInventory.items[itemIndex];

      res.json({
        ok: true,
        message: newQuantity === 0 ? "Item marked as finished" : "Item updated successfully",
        item: {
          foodItemId: itemId,
          name: updatedItem?.foodItem?.name,
          quantity: newQuantity,
          locked: item.locked,
          available: newQuantity - (item.locked || 0),
          manualRestocked: item.manualRestocked,
          status: item.status,
          isPermanent: updatedItem?.foodItem?.isPermanent || false
        }
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

      const inventory = await SupervisorInventory.findOne({
        supervisor: supervisorId,
      });

      if (!inventory) {
        return res.status(404).json({ error: "No inventory found" });
      }

      const item = inventory.items.find(
        (i) => String(i.foodItem) === String(itemId)
      );

      if (!item) {
        return res.status(404).json({ error: "Item not found in inventory" });
      }
      
      if (item.status === "finished") {
        return res.status(400).json({ error: "Cannot lock finished item" });
      }

      const available = item.quantity - (item.locked || 0);
      if (quantity > available) {
        return res.status(400).json({ 
          error: `Cannot lock ${quantity} items. Only ${available} available` 
        });
      }

      // Lock the items
      item.locked = (item.locked || 0) + quantity;

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

      const inventory = await SupervisorInventory.findOne({
        supervisor: supervisorId,
      });

      if (!inventory) {
        return res.status(404).json({ error: "No inventory found" });
      }

      const item = inventory.items.find(
        (i) => String(i.foodItem) === String(itemId)
      );

      if (!item) {
        return res.status(404).json({ error: "Item not found in inventory" });
      }

      if (quantity > (item.locked || 0)) {
        return res.status(400).json({ 
          error: `Cannot unlock ${quantity} items. Only ${item.locked} locked` 
        });
      }

      // Unlock the items
      item.locked = (item.locked || 0) - quantity;

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
 * @desc    Remove item from permanent inventory
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

      const inventory = await SupervisorInventory.findOne({
        supervisor: supervisorId,
      });

      if (!inventory) {
        return res.status(404).json({ error: "No inventory found" });
      }

      const itemIndex = inventory.items.findIndex(
        (i) => String(i.foodItem) === String(itemId)
      );

      if (itemIndex === -1) {
        return res.status(404).json({ error: "Item not found in inventory" });
      }

      const item = inventory.items[itemIndex];
      
      // Check if item has locked quantities
      if ((item.locked || 0) > 0) {
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
 * @route   DELETE /api/supervisor-inventory/daily-items/:itemId
 * @desc    Remove item from today's daily inventory
 * @access  Private (Supervisor only)
 */
router.delete(
  "/daily-items/:itemId",
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
        date: today
      });

      if (!inventory) {
        return res.status(404).json({ error: "No daily inventory found" });
      }

      const itemIndex = inventory.items.findIndex(
        (i) => String(i._id) === String(itemId) || String(i.foodItem) === String(itemId)
      );

      if (itemIndex === -1) {
        return res.status(404).json({ error: "Item not found in daily inventory" });
      }

      const item = inventory.items[itemIndex];
      
      // Check if item has locked quantities
      if ((item.locked || 0) > 0) {
        return res.status(400).json({ 
          error: "Cannot remove item with locked quantities. Unlock first." 
        });
      }

      // Remove the item
      inventory.items.splice(itemIndex, 1);

      await inventory.save();

      res.json({
        ok: true,
        message: "Item removed from daily inventory successfully"
      });
    } catch (err) {
      console.error("Remove daily item error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @route   POST /api/supervisor-inventory/items/:itemId/restore
 * @desc    Restore a finished item back to active inventory
 * @access  Private (Supervisor only)
 */
router.post(
  "/items/:itemId/restore",
  auth,
  requireRole("supervisor"),
  [
    body("quantity").optional().isInt({ min: 1 }).withMessage("Quantity must be a positive integer")
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const supervisorId = req.user.id;
      const { itemId } = req.params;
      const { quantity, notes, isManualRestock = true } = req.body;

      const inventory = await SupervisorInventory.findOne({
        supervisor: supervisorId,
      });

      if (!inventory) {
        return res.status(404).json({ error: "No inventory found" });
      }

      const item = inventory.items.find(
        (i) => String(i.foodItem) === String(itemId)
      );

      if (!item) {
        return res.status(404).json({ error: "Item not found in inventory" });
      }

      if (item.status !== "finished") {
        return res.status(400).json({ error: "Item is already active" });
      }

      const newQuantity = quantity || 1;
      
      // Restore the item
      item.status = "active";
      item.quantity = newQuantity;
      item.lastRestockedAt = new Date();
      
      if (isManualRestock) {
        item.manualRestocked = (item.manualRestocked || 0) + newQuantity;
      }

      await inventory.save();

      res.json({
        ok: true,
        message: "Item restored successfully",
        item: {
          foodItemId: itemId,
          quantity: item.quantity,
          status: item.status,
          manualRestocked: item.manualRestocked,
          lastRestockedAt: item.lastRestockedAt
        }
      });
    } catch (err) {
      console.error("Restore item error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @route   GET /api/supervisor-inventory/finished-items
 * @desc    Get all finished items (items with zero quantity)
 * @access  Private (Supervisor only)
 */
router.get("/finished-items", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const supervisorId = req.user.id;

    const inventory = await SupervisorInventory.findOne({
      supervisor: supervisorId,
    }).populate({
      path: "items.foodItem",
      select: "name price category unit minimumStock description isPermanent",
      populate: { path: "category", select: "name" }
    });

    if (!inventory) {
      return res.json({
        ok: true,
        finishedItems: []
      });
    }

    const finishedItems = inventory.items
      .filter(item => item.status === "finished")
      .map(item => ({
        id: item._id,
        foodItem: item.foodItem?._id,
        name: item.foodItem?.name || "Unknown",
        category: item.foodItem?.category?.name || "Uncategorized",
        unit: item.foodItem?.unit || "piece",
        lastQuantity: item.quantity,
        finishedAt: item.updatedAt,
        isPermanent: item.foodItem?.isPermanent || false,
        canRestore: true
      }));

    res.json({
      ok: true,
      finishedItems,
      totalFinished: finishedItems.length
    });
  } catch (err) {
    console.error("Get finished items error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * @route   GET /api/supervisor-inventory/search
 * @desc    Search inventory items
 * @access  Private (Supervisor only)
 */
router.get("/search", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const { q, category, status, minStock, type } = req.query;

    const inventory = await SupervisorInventory.findOne({
      supervisor: supervisorId,
    }).populate({
      path: "items.foodItem",
      select: "name price category unit minimumStock description isPermanent",
      populate: { path: "category", select: "name" }
    });

    if (!inventory) {
      return res.json({
        ok: true,
        items: []
      });
    }

    let items = inventory.items.filter(item => item.status === "active");

    // Filter by type (permanent or temporary)
    if (type === "permanent") {
      items = items.filter(item => item.foodItem?.isPermanent === true);
    } else if (type === "temporary") {
      items = items.filter(item => item.foodItem?.isPermanent === false);
    }

    // Apply filters
    if (q) {
      items = items.filter(item => 
        item.foodItem?.name?.toLowerCase().includes(q.toLowerCase())
      );
    }

    if (category) {
      items = items.filter(item => 
        String(item.foodItem?.category?._id) === category ||
        item.foodItem?.category?.name?.toLowerCase() === category.toLowerCase()
      );
    }

    if (status) {
      const available = item => item.quantity - (item.locked || 0);
      if (status === "low_stock") {
        items = items.filter(item => 
          available(item) <= (item.foodItem?.minimumStock || 0) && available(item) > 0
        );
      } else if (status === "out_of_stock") {
        items = items.filter(item => available(item) <= 0);
      } else if (status === "in_stock") {
        items = items.filter(item => available(item) > 0);
      }
    }

    if (minStock) {
      items = items.filter(item => 
        item.quantity <= item.foodItem?.minimumStock
      );
    }

    const formattedItems = items.map(item => ({
      id: item._id,
      foodItem: item.foodItem?._id,
      name: item.foodItem?.name || "Unknown",
      category: item.foodItem?.category?.name || "Uncategorized",
      price: item.foodItem?.price || 0,
      unit: item.foodItem?.unit || "piece",
      minimumStock: item.foodItem?.minimumStock || 0,
      quantity: item.quantity,
      locked: item.locked || 0,
      available: item.quantity - (item.locked || 0),
      manualRestocked: item.manualRestocked,
      lastRestockedAt: item.lastRestockedAt,
      isPermanent: item.foodItem?.isPermanent || false
    }));

    res.json({
      ok: true,
      items: formattedItems,
      total: formattedItems.length
    });
  } catch (err) {
    console.error("Search inventory error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;