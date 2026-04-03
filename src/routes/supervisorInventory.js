import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { PermanentInventory, DailyInventory } from "../models/SupervisorInventory.js";
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

// Helper function to get today's date at midnight
const getTodayDate = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

// Helper function to format inventory items
const formatInventoryItem = (item, foodItem) => {
  const available = item.quantity - (item.locked || 0);
  const lowStock = foodItem?.minimumStock ? 
    available <= foodItem.minimumStock : false;
  
  return {
    id: item._id,
    foodItem: foodItem?._id,
    name: foodItem?.name || "Unknown",
    price: foodItem?.price || 0,
    category: foodItem?.category?.name || "Uncategorized",
    unit: foodItem?.unit || "piece",
    minimumStock: foodItem?.minimumStock || 0,
    quantity: item.quantity,
    locked: item.locked || 0,
    available,
    manualRestocked: item.manualRestocked,
    lastRestockedAt: item.lastRestockedAt,
    isPermanent: false,
    status: available <= 0 ? "out_of_stock" : lowStock ? "low_stock" : "in_stock",
    notes: item.notes,
    totalValue: (foodItem?.price || 0) * item.quantity,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
};

// ==================== PERMANENT INVENTORY ROUTES ====================

/**
 * @route   GET /api/supervisor-inventory/permanent
 * @desc    Get supervisor's permanent inventory
 * @access  Private (Supervisor only)
 */
router.get("/permanent", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const supervisorId = req.user.id;

    let inventory = await PermanentInventory.findOne({
      supervisor: supervisorId,
    }).populate({
      path: "items.foodItem",
      select: "name price category unit minimumStock description isPermanent",
      populate: { path: "category", select: "name description" }
    });

    if (!inventory) {
      inventory = await PermanentInventory.create({
        supervisor: supervisorId,
        items: [],
        isActive: true
      });

      inventory = await PermanentInventory.findById(inventory._id).populate({
        path: "items.foodItem",
        select: "name price category unit minimumStock description isPermanent",
        populate: { path: "category", select: "name description" }
      });
    }

    const activeItems = (inventory.items || [])
      .filter(item => item.status === "active")
      .map(item => ({
        ...formatInventoryItem(item, item.foodItem),
        isPermanent: true
      }));

    const finishedItems = (inventory.items || [])
      .filter(item => item.status === "finished")
      .map(item => ({
        id: item._id,
        foodItem: item.foodItem?._id,
        name: item.foodItem?.name || "Unknown",
        quantity: item.quantity,
        finishedAt: item.updatedAt
      }));

    const totalQuantity = activeItems.reduce((sum, item) => sum + item.quantity, 0);
    const totalAvailable = activeItems.reduce((sum, item) => sum + item.available, 0);
    const totalLocked = activeItems.reduce((sum, item) => sum + item.locked, 0);
    const totalValue = activeItems.reduce((sum, item) => sum + (item.quantity * item.price), 0);

    res.json({
      ok: true,
      inventory: {
        id: inventory._id,
        type: "permanent",
        items: activeItems,
        finishedItems,
        totalItems: activeItems.length,
        totalQuantity,
        totalAvailable,
        totalLocked,
        totalValue,
        lowStockItems: activeItems.filter(item => item.status === "low_stock").length,
        outOfStockItems: activeItems.filter(item => item.status === "out_of_stock").length
      }
    });
  } catch (err) {
    console.error("Get permanent inventory error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * @route   GET /api/supervisor-inventory/permanent-stock
 * @desc    Get permanent stock items for assignment (simplified version)
 * @access  Private (Supervisor only)
 */
router.get("/permanent-stock", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const supervisorId = req.user.id;

    let inventory = await PermanentInventory.findOne({
      supervisor: supervisorId,
    }).populate({
      path: "items.foodItem",
      select: "name price category unit minimumStock description isPermanent",
      populate: { path: "category", select: "name description" }
    });

    if (!inventory) {
      inventory = await PermanentInventory.create({
        supervisor: supervisorId,
        items: [],
        isActive: true
      });

      inventory = await PermanentInventory.findById(inventory._id).populate({
        path: "items.foodItem",
        select: "name price category unit minimumStock description isPermanent",
        populate: { path: "category", select: "name description" }
      });
    }

    const activeItems = (inventory.items || [])
      .filter(item => item.status === "active" && item.foodItem)
      .map(item => {
        const available = item.quantity - (item.locked || 0);
        const lowStock = item.foodItem?.minimumStock ? 
          available <= item.foodItem.minimumStock : false;
        
        return {
          id: item._id,
          _id: item.foodItem._id,
          foodItemId: item.foodItem._id,
          name: item.foodItem.name,
          price: item.foodItem.price,
          category: item.foodItem.category?.name || "Uncategorized",
          unit: item.foodItem.unit || "piece",
          imageUrl: item.foodItem.imageUrl,
          isPermanent: true,
          quantity: item.quantity,
          locked: item.locked || 0,
          available: available,
          minimumStock: item.foodItem.minimumStock || 0,
          lowStock: lowStock,
          status: available <= 0 ? "out_of_stock" : lowStock ? "low_stock" : "in_stock",
          lastRestockedAt: item.lastRestockedAt,
          notes: item.notes,
          totalValue: item.quantity * (item.foodItem.price || 0)
        };
      });

    const summary = {
      totalItems: activeItems.length,
      totalQuantity: activeItems.reduce((sum, item) => sum + item.quantity, 0),
      totalAvailable: activeItems.reduce((sum, item) => sum + item.available, 0),
      totalLocked: activeItems.reduce((sum, item) => sum + (item.locked || 0), 0),
      totalValue: activeItems.reduce((sum, item) => sum + (item.quantity * item.price), 0),
      lowStockCount: activeItems.filter(item => item.lowStock).length,
      outOfStockCount: activeItems.filter(item => item.available <= 0).length
    };

    res.json({
      ok: true,
      items: activeItems,
      summary
    });

  } catch (err) {
    console.error("Get permanent stock error:", err);
    res.status(500).json({ error: "Server error fetching permanent stock" });
  }
});

/**
 * @route   POST /api/supervisor-inventory/permanent/restock
 * @desc    Restock permanent inventory items
 * @access  Private (Supervisor only)
 */
router.post(
  "/permanent/restock",
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

      let inventory = await PermanentInventory.findOne({
        supervisor: supervisorId,
      });

      if (!inventory) {
        inventory = await PermanentInventory.create({
          supervisor: supervisorId,
          items: [],
          isActive: true
        });
      }

      const results = [];

      for (const restockItem of items) {
        const { foodItemId, quantity } = restockItem;
        const quantityNum = Number(quantity);

        const foodItem = await FoodItem.findById(foodItemId);
        if (!foodItem) {
          results.push({ foodItemId, success: false, error: "Food item not found" });
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
          
          if (notes) existingItem.notes = notes;
          
          results.push({
            foodItemId,
            success: true,
            name: foodItem.name,
            newQuantity: existingItem.quantity,
            itemId: existingItem._id
          });
        } else {
          const newItem = {
            foodItem: foodItemId,
            quantity: quantityNum,
            locked: 0,
            manualRestocked: quantityNum,
            lastRestockedAt: new Date(),
            status: "active",
            notes: notes || ""
          };
          
          inventory.items.push(newItem);
          
          results.push({
            foodItemId,
            success: true,
            name: foodItem.name,
            newQuantity: quantityNum,
            itemId: newItem._id
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
 * @route   PUT /api/supervisor-inventory/permanent/items/:itemId
 * @desc    Update permanent inventory item quantity
 * @access  Private (Supervisor only)
 */
router.put(
  "/permanent/items/:itemId",
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
      const quantityNum = Number(quantity);

      let inventory = await PermanentInventory.findOne({
        supervisor: supervisorId,
      }).populate({
        path: "items.foodItem",
        select: "name price category unit minimumStock isPermanent"
      });

      if (!inventory) {
        return res.status(404).json({ error: "No permanent inventory found" });
      }

      let itemIndex = inventory.items.findIndex(
        (i) => String(i._id) === String(itemId)
      );
      
      if (itemIndex === -1) {
        itemIndex = inventory.items.findIndex(
          (i) => String(i.foodItem?._id) === String(itemId)
        );
      }

      if (itemIndex === -1) {
        return res.status(404).json({ error: "Item not found in permanent inventory" });
      }

      const item = inventory.items[itemIndex];
      
      if (item.status === "finished") {
        return res.status(400).json({ error: "Cannot update finished item" });
      }
      
      const available = item.quantity - (item.locked || 0);
      let newQuantity = item.quantity;

      switch (operation) {
        case "set":
          if (quantityNum < (item.locked || 0)) {
            return res.status(400).json({ 
              error: `Cannot set quantity below locked amount (${item.locked})` 
            });
          }
          newQuantity = quantityNum;
          break;
        case "add":
          newQuantity = item.quantity + quantityNum;
          break;
        case "remove":
          if (quantityNum > available) {
            return res.status(400).json({ 
              error: `Cannot remove ${quantityNum} items. Only ${available} available` 
            });
          }
          newQuantity = item.quantity - quantityNum;
          break;
        default:
          return res.status(400).json({ error: "Invalid operation" });
      }

      item.quantity = newQuantity;
      if (notes) item.notes = notes;
      
      if (newQuantity === 0) {
        item.status = "finished";
      } else if (item.status === "finished") {
        item.status = "active";
      }

      await inventory.save();

      res.json({
        ok: true,
        message: newQuantity === 0 ? "Item marked as finished" : "Item updated successfully",
        item: {
          id: item._id,
          foodItemId: item.foodItem?._id,
          name: item.foodItem?.name || "Unknown",
          quantity: item.quantity,
          locked: item.locked || 0,
          available: item.quantity - (item.locked || 0),
          isPermanent: true,
          price: item.foodItem?.price || 0,
          totalValue: item.quantity * (item.foodItem?.price || 0)
        }
      });
    } catch (err) {
      console.error("Update permanent item error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @route   DELETE /api/supervisor-inventory/permanent/items/:itemId
 * @desc    Delete item from permanent inventory
 * @access  Private (Supervisor only)
 */
router.delete(
  "/permanent/items/:itemId",
  auth,
  requireRole("supervisor"),
  async (req, res) => {
    try {
      const supervisorId = req.user.id;
      const { itemId } = req.params;

      let inventory = await PermanentInventory.findOne({
        supervisor: supervisorId,
      }).populate({
        path: "items.foodItem",
        select: "name"
      });

      if (!inventory) {
        return res.status(404).json({ error: "No permanent inventory found" });
      }

      let itemIndex = inventory.items.findIndex(
        (i) => String(i._id) === String(itemId)
      );
      
      if (itemIndex === -1) {
        itemIndex = inventory.items.findIndex(
          (i) => String(i.foodItem?._id) === String(itemId)
        );
      }

      if (itemIndex === -1) {
        return res.status(404).json({ error: "Item not found in permanent inventory" });
      }

      const item = inventory.items[itemIndex];
      
      if (item.locked > 0) {
        return res.status(400).json({ 
          error: `Cannot delete item with locked stock (${item.locked} items locked). Please unlock the items first.` 
        });
      }

      const removedItem = {
        id: item._id,
        foodItemId: item.foodItem?._id,
        name: item.foodItem?.name || "Unknown",
        quantity: item.quantity
      };

      inventory.items.splice(itemIndex, 1);
      await inventory.save();

      res.json({
        ok: true,
        message: "Item removed from permanent stock successfully",
        removedItem
      });
    } catch (err) {
      console.error("Delete permanent item error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// ==================== DAILY INVENTORY ROUTES ====================

/**
 * @route   GET /api/supervisor-inventory/daily
 * @desc    Get today's daily inventory (ONLY temporary items)
 * @access  Private (Supervisor only)
 */
router.get("/daily", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const today = getTodayDate();
    const { date } = req.query;

    let queryDate = today;
    if (date) {
      queryDate = new Date(date);
      queryDate.setHours(0, 0, 0, 0);
    }

    let dailyInventory = await DailyInventory.findOne({
      supervisor: supervisorId,
      date: queryDate
    }).populate({
      path: "items.foodItem",
      select: "name price category unit minimumStock isPermanent description",
      populate: { path: "category", select: "name description" }
    });

    // Create EMPTY daily inventory if it doesn't exist
    if (!dailyInventory && !date) {
      dailyInventory = await DailyInventory.create({
        supervisor: supervisorId,
        date: today,
        items: [],
        status: "active",
        summary: {
          totalItems: 0,
          totalQuantity: 0,
          totalLocked: 0,
          totalSold: 0,
          totalWasted: 0,
          totalValue: 0
        }
      });

      dailyInventory = await DailyInventory.findById(dailyInventory._id).populate({
        path: "items.foodItem",
        select: "name price category unit minimumStock isPermanent description",
        populate: { path: "category", select: "name description" }
      });
    }

    if (!dailyInventory) {
      return res.json({
        ok: true,
        inventory: {
          id: null,
          date: queryDate,
          items: [],
          totalItems: 0,
          totalQuantity: 0,
          totalAvailable: 0,
          totalLocked: 0,
          totalValue: 0
        }
      });
    }

    // Filter out any permanent items
    const filteredItems = (dailyInventory.items || [])
      .filter(item => {
        if (item.foodItem?.isPermanent === true) {
          return false;
        }
        return item.status === "active";
      });

    const formattedItems = filteredItems.map(item => formatInventoryItem(item, item.foodItem));

    const totalQuantity = formattedItems.reduce((sum, item) => sum + item.quantity, 0);
    const totalAvailable = formattedItems.reduce((sum, item) => sum + item.available, 0);
    const totalLocked = formattedItems.reduce((sum, item) => sum + item.locked, 0);
    const totalValue = formattedItems.reduce((sum, item) => sum + (item.quantity * item.price), 0);

    res.json({
      ok: true,
      inventory: {
        id: dailyInventory._id,
        type: "daily",
        date: dailyInventory.date,
        status: dailyInventory.status,
        items: formattedItems,
        summary: {
          ...dailyInventory.summary,
          totalValue: totalValue
        },
        totalItems: formattedItems.length,
        totalQuantity,
        totalAvailable,
        totalLocked,
        totalValue,
        lowStockItems: formattedItems.filter(item => item.status === "low_stock").length,
        outOfStockItems: formattedItems.filter(item => item.status === "out_of_stock").length
      }
    });
  } catch (err) {
    console.error("Get daily inventory error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * @route   POST /api/supervisor-inventory/daily/items
 * @desc    Add temporary item to daily inventory
 * @access  Private (Supervisor only)
 */
router.post(
  "/daily/items",
  auth,
  requireRole("supervisor"),
  validateInventoryItem,
  handleValidationErrors,
  async (req, res) => {
    try {
      const supervisorId = req.user.id;
      const { foodItemId, quantity, notes } = req.body;
      const today = getTodayDate();

      const foodItem = await FoodItem.findById(foodItemId);
      if (!foodItem) {
        return res.status(404).json({ error: "Food item not found" });
      }

      // Prevent permanent items from being added
      if (foodItem.isPermanent === true) {
        return res.status(400).json({ 
          error: "Permanent items cannot be added to daily inventory. Use Permanent Stock section." 
        });
      }

      let dailyInventory = await DailyInventory.findOne({
        supervisor: supervisorId,
        date: today
      });

      if (!dailyInventory) {
        dailyInventory = await DailyInventory.create({
          supervisor: supervisorId,
          date: today,
          items: [],
          status: "active"
        });
      }

      const quantityNum = Number(quantity);
      
      const existingItemIndex = dailyInventory.items.findIndex(
        (i) => String(i.foodItem) === String(foodItemId)
      );

      let addedItem;
      if (existingItemIndex > -1) {
        const existingItem = dailyInventory.items[existingItemIndex];
        
        if (existingItem.status === "finished") {
          existingItem.status = "active";
        }
        
        existingItem.quantity += quantityNum;
        existingItem.lastRestockedAt = new Date();
        existingItem.notes = notes || existingItem.notes;
        addedItem = existingItem;
      } else {
        const newItem = {
          foodItem: foodItemId,
          quantity: quantityNum,
          locked: 0,
          manualRestocked: quantityNum,
          lastRestockedAt: new Date(),
          status: "active",
          notes: notes || ""
        };
        dailyInventory.items.push(newItem);
        addedItem = newItem;
      }

      // Update summary
      const activeItems = dailyInventory.items.filter(i => i.status === "active");
      const totalValue = activeItems.reduce((sum, i) => {
        const price = i.foodItem?.price || 0;
        return sum + (i.quantity * price);
      }, 0);
      
      dailyInventory.summary.totalItems = activeItems.length;
      dailyInventory.summary.totalQuantity = activeItems.reduce((sum, i) => sum + i.quantity, 0);
      dailyInventory.summary.totalLocked = activeItems.reduce((sum, i) => sum + (i.locked || 0), 0);
      dailyInventory.summary.totalValue = totalValue;
      
      await dailyInventory.save();

      const updatedInventory = await DailyInventory.findById(dailyInventory._id).populate({
        path: "items.foodItem",
        select: "name price category unit minimumStock isPermanent"
      });
      
      const updatedItem = updatedInventory.items.find(
        i => String(i.foodItem._id) === String(foodItemId)
      );

      res.json({
        ok: true,
        message: "Item added to daily inventory successfully",
        item: formatInventoryItem(updatedItem, updatedItem?.foodItem)
      });
    } catch (err) {
      console.error("Add daily item error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @route   PUT /api/supervisor-inventory/daily/items/:itemId
 * @desc    Update daily inventory item quantity
 * @access  Private (Supervisor only)
 */
router.put(
  "/daily/items/:itemId",
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
      const today = getTodayDate();
      const quantityNum = Number(quantity);

      const dailyInventory = await DailyInventory.findOne({
        supervisor: supervisorId,
        date: today
      }).populate({
        path: "items.foodItem",
        select: "name price unit minimumStock isPermanent"
      });

      if (!dailyInventory) {
        return res.status(404).json({ error: "No daily inventory found for today" });
      }

      let itemIndex = dailyInventory.items.findIndex(
        (i) => String(i._id) === String(itemId)
      );
      
      if (itemIndex === -1) {
        itemIndex = dailyInventory.items.findIndex(
          (i) => String(i.foodItem?._id) === String(itemId)
        );
      }

      if (itemIndex === -1) {
        return res.status(404).json({ error: "Item not found in daily inventory" });
      }

      const item = dailyInventory.items[itemIndex];
      
      if (item.foodItem?.isPermanent === true) {
        return res.status(400).json({ error: "Cannot update permanent items in daily inventory" });
      }
      
      if (item.status === "finished") {
        return res.status(400).json({ error: "Cannot update finished item" });
      }
      
      const available = item.quantity - (item.locked || 0);
      let newQuantity = item.quantity;

      switch (operation) {
        case "set":
          if (quantityNum < (item.locked || 0)) {
            return res.status(400).json({ 
              error: `Cannot set quantity below locked amount (${item.locked})` 
            });
          }
          newQuantity = quantityNum;
          break;
        case "add":
          newQuantity = item.quantity + quantityNum;
          break;
        case "remove":
          if (quantityNum > available) {
            return res.status(400).json({ 
              error: `Cannot remove ${quantityNum} items. Only ${available} available` 
            });
          }
          newQuantity = item.quantity - quantityNum;
          break;
        default:
          return res.status(400).json({ error: "Invalid operation" });
      }

      item.quantity = newQuantity;
      if (notes) item.notes = notes;
      
      if (newQuantity === 0) {
        item.status = "finished";
      } else if (item.status === "finished") {
        item.status = "active";
      }

      // Update summary
      const activeItems = dailyInventory.items.filter(i => i.status === "active");
      const totalValue = activeItems.reduce((sum, i) => {
        const price = i.foodItem?.price || 0;
        return sum + (i.quantity * price);
      }, 0);
      
      dailyInventory.summary.totalItems = activeItems.length;
      dailyInventory.summary.totalQuantity = activeItems.reduce((sum, i) => sum + i.quantity, 0);
      dailyInventory.summary.totalLocked = activeItems.reduce((sum, i) => sum + (i.locked || 0), 0);
      dailyInventory.summary.totalValue = totalValue;

      await dailyInventory.save();

      res.json({
        ok: true,
        message: newQuantity === 0 ? "Item marked as finished" : "Item updated successfully",
        item: {
          id: item._id,
          foodItemId: item.foodItem?._id,
          name: item.foodItem?.name || "Unknown",
          quantity: item.quantity,
          locked: item.locked || 0,
          available: item.quantity - (item.locked || 0),
          isPermanent: false,
          price: item.foodItem?.price || 0,
          totalValue: item.quantity * (item.foodItem?.price || 0)
        }
      });
    } catch (err) {
      console.error("Update daily item error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @route   DELETE /api/supervisor-inventory/daily/items/:itemId
 * @desc    Delete item from daily inventory
 * @access  Private (Supervisor only)
 */
router.delete(
  "/daily/items/:itemId",
  auth,
  requireRole("supervisor"),
  async (req, res) => {
    try {
      const supervisorId = req.user.id;
      const { itemId } = req.params;
      const today = getTodayDate();

      let dailyInventory = await DailyInventory.findOne({
        supervisor: supervisorId,
        date: today
      }).populate({
        path: "items.foodItem",
        select: "name isPermanent"
      });

      if (!dailyInventory) {
        return res.status(404).json({ error: "No daily inventory found for today" });
      }

      let itemIndex = dailyInventory.items.findIndex(
        (i) => String(i._id) === String(itemId)
      );
      
      if (itemIndex === -1) {
        itemIndex = dailyInventory.items.findIndex(
          (i) => String(i.foodItem?._id) === String(itemId)
        );
      }

      if (itemIndex === -1) {
        return res.status(404).json({ error: "Item not found in daily inventory" });
      }

      const item = dailyInventory.items[itemIndex];
      
      if (item.locked > 0) {
        return res.status(400).json({ 
          error: `Cannot delete item with locked stock (${item.locked} items locked). Please unlock the items first.` 
        });
      }

      const removedItem = {
        id: item._id,
        foodItemId: item.foodItem?._id,
        name: item.foodItem?.name || "Unknown",
        quantity: item.quantity
      };

      dailyInventory.items.splice(itemIndex, 1);
      
      // Update summary
      const activeItems = dailyInventory.items.filter(i => i.status === "active");
      const totalValue = activeItems.reduce((sum, i) => {
        const price = i.foodItem?.price || 0;
        return sum + (i.quantity * price);
      }, 0);
      
      dailyInventory.summary.totalItems = activeItems.length;
      dailyInventory.summary.totalQuantity = activeItems.reduce((sum, i) => sum + i.quantity, 0);
      dailyInventory.summary.totalLocked = activeItems.reduce((sum, i) => sum + (i.locked || 0), 0);
      dailyInventory.summary.totalValue = totalValue;
      
      await dailyInventory.save();

      res.json({
        ok: true,
        message: "Item removed from daily inventory successfully",
        removedItem
      });
    } catch (err) {
      console.error("Delete daily item error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @route   POST /api/supervisor-inventory/daily/complete
 * @desc    Complete the day and close daily inventory
 * @access  Private (Supervisor only)
 */
router.post(
  "/daily/complete",
  auth,
  requireRole("supervisor"),
  async (req, res) => {
    try {
      const supervisorId = req.user.id;
      const today = getTodayDate();
      const { notes } = req.body;

      const dailyInventory = await DailyInventory.findOne({
        supervisor: supervisorId,
        date: today
      });

      if (!dailyInventory) {
        return res.status(404).json({ error: "No daily inventory found for today" });
      }

      const activeItems = dailyInventory.items.filter(i => i.status === "active");
      const totalSold = activeItems.reduce((sum, i) => sum + (i.manualRestocked || 0), 0);
      const totalWasted = activeItems.reduce((sum, i) => {
        const wasted = i.quantity - (i.locked || 0);
        return sum + (wasted > 0 ? wasted : 0);
      }, 0);
      const totalValue = activeItems.reduce((sum, i) => {
        const price = i.foodItem?.price || 0;
        return sum + (i.quantity * price);
      }, 0);

      dailyInventory.status = "completed";
      dailyInventory.summary = {
        totalItems: activeItems.length,
        totalQuantity: activeItems.reduce((sum, i) => sum + i.quantity, 0),
        totalLocked: activeItems.reduce((sum, i) => sum + (i.locked || 0), 0),
        totalSold,
        totalWasted,
        totalValue
      };
      
      if (notes) dailyInventory.notes = notes;
      
      await dailyInventory.save();

      res.json({
        ok: true,
        message: "Daily inventory completed successfully",
        summary: dailyInventory.summary
      });
    } catch (err) {
      console.error("Complete daily inventory error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/**
 * @route   GET /api/supervisor-inventory/daily/history-with-value
 * @desc    Get daily inventory history with value calculations
 * @access  Private (Supervisor only)
 */
router.get("/daily/history-with-value", auth, requireRole("supervisor"), async (req, res) => {
  try {
    const supervisorId = req.user.id;
    const { startDate, endDate, limit = 30 } = req.query;

    let query = { supervisor: supervisorId };
    
    if (startDate || endDate) {
      query.date = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.date.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    const dailyInventories = await DailyInventory.find(query)
      .sort({ date: -1 })
      .limit(parseInt(limit))
      .populate({
        path: "items.foodItem",
        select: "name price category unit isPermanent"
      });

    const history = dailyInventories.map(inv => {
      let totalValue = 0;
      const items = (inv.items || [])
        .filter(item => item.foodItem && item.foodItem.isPermanent !== true)
        .map(item => {
          const itemValue = item.quantity * (item.foodItem?.price || 0);
          totalValue += itemValue;
          return {
            name: item.foodItem?.name || "Unknown",
            quantity: item.quantity,
            price: item.foodItem?.price || 0,
            totalValue: itemValue,
            status: item.status,
            createdAt: item.createdAt
          };
        });
      
      return {
        id: inv._id,
        date: inv.date,
        status: inv.status,
        summary: {
          ...inv.summary,
          totalValue: totalValue,
          totalItems: items.length,
          totalQuantity: items.reduce((sum, i) => sum + i.quantity, 0)
        },
        notes: inv.notes,
        itemCount: items.length,
        items: items
      };
    });

    res.json({
      ok: true,
      history,
      total: history.length
    });
  } catch (err) {
    console.error("Get daily history with value error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * @route   DELETE /api/supervisor-inventory/daily/reset
 * @desc    Reset today's daily inventory (clear all items)
 * @access  Private (Supervisor only)
 */
router.delete(
  "/daily/reset",
  auth,
  requireRole("supervisor"),
  async (req, res) => {
    try {
      const supervisorId = req.user.id;
      const today = getTodayDate();

      const dailyInventory = await DailyInventory.findOne({
        supervisor: supervisorId,
        date: today
      });

      if (!dailyInventory) {
        return res.status(404).json({ error: "No daily inventory found for today" });
      }

      const hasLockedItems = dailyInventory.items.some(item => (item.locked || 0) > 0);
      if (hasLockedItems) {
        return res.status(400).json({ 
          error: "Cannot reset inventory with locked items. Please unlock all items first." 
        });
      }

      dailyInventory.items = [];
      dailyInventory.status = "active";
      dailyInventory.summary = {
        totalItems: 0,
        totalQuantity: 0,
        totalLocked: 0,
        totalSold: 0,
        totalWasted: 0,
        totalValue: 0
      };
      
      await dailyInventory.save();

      res.json({
        ok: true,
        message: "Daily inventory reset successfully",
        inventory: {
          items: [],
          summary: dailyInventory.summary
        }
      });
    } catch (err) {
      console.error("Reset daily inventory error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// ==================== COMMON INVENTORY ROUTES ====================

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
    body("quantity").isInt({ min: 1 }).withMessage("Quantity must be a positive integer"),
    body("inventoryType").isIn(["permanent", "daily"]).withMessage("Invalid inventory type")
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const supervisorId = req.user.id;
      const { itemId } = req.params;
      const { quantity, inventoryType, notes } = req.body;
      const today = getTodayDate();
      const quantityNum = Number(quantity);

      let inventory;
      if (inventoryType === "permanent") {
        inventory = await PermanentInventory.findOne({ supervisor: supervisorId });
      } else {
        inventory = await DailyInventory.findOne({ supervisor: supervisorId, date: today });
      }

      if (!inventory) {
        return res.status(404).json({ error: `No ${inventoryType} inventory found` });
      }

      const item = inventory.items.find(
        (i) => String(i._id) === String(itemId) || String(i.foodItem) === String(itemId)
      );

      if (!item) {
        return res.status(404).json({ error: "Item not found in inventory" });
      }
      
      if (item.status === "finished") {
        return res.status(400).json({ error: "Cannot lock finished item" });
      }

      const available = item.quantity - (item.locked || 0);
      if (quantityNum > available) {
        return res.status(400).json({ 
          error: `Cannot lock ${quantityNum} items. Only ${available} available` 
        });
      }

      item.locked = (item.locked || 0) + quantityNum;
      await inventory.save();

      res.json({
        ok: true,
        message: "Items locked successfully",
        item: {
          id: item._id,
          foodItemId: item.foodItem,
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
    body("quantity").isInt({ min: 1 }).withMessage("Quantity must be a positive integer"),
    body("inventoryType").isIn(["permanent", "daily"]).withMessage("Invalid inventory type")
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const supervisorId = req.user.id;
      const { itemId } = req.params;
      const { quantity, inventoryType, notes } = req.body;
      const today = getTodayDate();
      const quantityNum = Number(quantity);

      let inventory;
      if (inventoryType === "permanent") {
        inventory = await PermanentInventory.findOne({ supervisor: supervisorId });
      } else {
        inventory = await DailyInventory.findOne({ supervisor: supervisorId, date: today });
      }

      if (!inventory) {
        return res.status(404).json({ error: `No ${inventoryType} inventory found` });
      }

      const item = inventory.items.find(
        (i) => String(i._id) === String(itemId) || String(i.foodItem) === String(itemId)
      );

      if (!item) {
        return res.status(404).json({ error: "Item not found in inventory" });
      }

      if (quantityNum > (item.locked || 0)) {
        return res.status(400).json({ 
          error: `Cannot unlock ${quantityNum} items. Only ${item.locked} locked` 
        });
      }

      item.locked = (item.locked || 0) - quantityNum;
      await inventory.save();

      res.json({
        ok: true,
        message: "Items unlocked successfully",
        item: {
          id: item._id,
          foodItemId: item.foodItem,
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

export default router;