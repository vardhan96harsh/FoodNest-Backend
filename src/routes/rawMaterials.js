// routes/rawMaterials.js (with PrepRequest integration)
import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { RawMaterial } from "../models/RawMaterial.js";
import { FoodItem } from "../models/FoodItem.js";
import { PrepRequest } from "../models/PrepRequest.js";
import { Team } from "../models/Team.js";
import mongoose from "mongoose";

const router = express.Router();

// ==================== HELPER FUNCTIONS ====================

const calculateStockStatus = (current, min, max) => {
  if (current <= 0) return 'out_of_stock';
  if (current < min) return 'low';
  if (current > max) return 'overstock';
  return 'adequate';
};

// ==================== RAW MATERIAL MANAGEMENT ====================

/**
 * GET /api/raw-materials
 * Get all raw materials
 */
router.get("/", auth, async (req, res) => {
  try {
    const { category, search, lowStock } = req.query;
    
    let query = { isDeleted: false };
    
    if (category) query.category = category;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }
    
    const materials = await RawMaterial.find(query)
      .sort({ name: 1 })
      .lean();

    const enhancedMaterials = materials.map(m => ({
      ...m,
      stockStatus: calculateStockStatus(m.currentStock, m.minimumStock, m.maximumStock),
      reorderQuantity: Math.max(0, m.maximumStock - m.currentStock),
      stockValue: m.currentStock * (m.averageCost || 0)
    }));

    let result = enhancedMaterials;
    if (lowStock === 'true') {
      result = result.filter(m => m.stockStatus === 'low' || m.stockStatus === 'out_of_stock');
    }

    res.json({
      ok: true,
      items: result,
      summary: {
        totalItems: result.length,
        lowStockCount: result.filter(m => m.stockStatus === 'low').length,
        outOfStockCount: result.filter(m => m.stockStatus === 'out_of_stock').length
      }
    });

  } catch (err) {
    console.error("Get raw materials error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/raw-materials
 * Create new raw material
 */
router.post("/", auth, requireRole(["superadmin", "supervisor"]), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      name,
      category,
      unit,
      currentStock = 0,
      minimumStock = 0,
      maximumStock = 1000,
      preferredSupplier,
      averageCost = 0
    } = req.body;

    // Check if exists
    const existing = await RawMaterial.findOne({ 
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      isDeleted: false 
    }).session(session);

    if (existing) {
      return res.status(409).json({ error: "Raw material already exists" });
    }

    const stockMovements = currentStock > 0 ? [{
      type: "purchase",
      quantity: currentStock,
      unit,
      previousStock: 0,
      newStock: currentStock,
      costPerUnit: averageCost,
      totalCost: averageCost * currentStock,
      notes: "Initial stock",
      performedBy: req.user.id,
      performedByName: req.user.name,
      createdAt: new Date()
    }] : [];

    const material = await RawMaterial.create([{
      name,
      category: category || "Other",
      unit,
      currentStock,
      minimumStock,
      maximumStock,
      preferredSupplier,
      averageCost,
      lastPurchaseCost: averageCost,
      stockMovements,
      createdBy: req.user.id
    }], { session });

    await session.commitTransaction();

    res.status(201).json({
      ok: true,
      material: material[0]
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("Create raw material error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

/**
 * POST /api/raw-materials/check-food-availability
 * Check if raw materials are available for a food item
 */
router.post("/check-food-availability", auth, async (req, res) => {
  try {
    const { foodId, quantity } = req.body;

    const foodItem = await FoodItem.findById(foodId);
    if (!foodItem) {
      return res.status(404).json({ error: "Food item not found" });
    }

    if (!foodItem.rawMaterials || foodItem.rawMaterials.length === 0) {
      return res.json({
        ok: true,
        available: true,
        message: "No raw materials required"
      });
    }

    const availability = [];
    let allAvailable = true;

    for (const rm of foodItem.rawMaterials) {
      const requiredQty = (rm.qty || 1) * quantity;
      
      const material = await RawMaterial.findOne({
        name: { $regex: new RegExp(`^${rm.name}$`, 'i') },
        isDeleted: false
      });

      if (!material) {
        allAvailable = false;
        availability.push({
          name: rm.name,
          required: requiredQty,
          unit: rm.unit || 'unit',
          available: 0,
          status: 'not_found'
        });
        continue;
      }

      const isAvailable = material.currentStock >= requiredQty;
      if (!isAvailable) allAvailable = false;

      availability.push({
        materialId: material._id,
        name: material.name,
        required: requiredQty,
        unit: material.unit,
        available: material.currentStock,
        status: isAvailable ? 'available' : 'insufficient',
        remainingAfter: material.currentStock - requiredQty
      });
    }

    res.json({
      ok: true,
      available: allAvailable,
      materials: availability,
      canProduce: allAvailable ? quantity : 0
    });

  } catch (err) {
    console.error("Check availability error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/raw-materials/consume-for-prep-request
 * Consume raw materials for a prep request
 */
router.post("/consume-for-prep-request", auth, requireRole(["supervisor", "cook"]), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { prepRequestId, notes } = req.body;

    // Get prep request
    const prepRequest = await PrepRequest.findById(prepRequestId)
      .populate("foodId")
      .session(session);

    if (!prepRequest) {
      throw new Error("Prep request not found");
    }

    if (prepRequest.status !== "processing") {
      throw new Error("Prep request must be in processing state");
    }

    if (prepRequest.rawMaterialsConsumed && prepRequest.rawMaterialsConsumed.length > 0) {
      throw new Error("Materials already consumed for this request");
    }

    const foodItem = prepRequest.foodId;
    const quantityToPrepare = prepRequest.quantityToPrepare || 1;

    if (!foodItem.rawMaterials || foodItem.rawMaterials.length === 0) {
      // No raw materials needed, just mark as consumed
      prepRequest.materialsConsumedAt = new Date();
      await prepRequest.save({ session });
      await session.commitTransaction();
      
      return res.json({
        ok: true,
        message: "No raw materials to consume",
        consumed: []
      });
    }

    // Calculate and consume each material
    const consumed = [];
    const errors = [];

    for (const rm of foodItem.rawMaterials) {
      const requiredQty = (rm.qty || 1) * quantityToPrepare;
      
      const material = await RawMaterial.findOne({
        name: { $regex: new RegExp(`^${rm.name}$`, 'i') },
        isDeleted: false
      }).session(session);

      if (!material) {
        errors.push(`Raw material '${rm.name}' not found`);
        continue;
      }

      if (material.currentStock < requiredQty) {
        errors.push(`Insufficient ${material.name}. Required: ${requiredQty} ${material.unit}, Available: ${material.currentStock} ${material.unit}`);
        continue;
      }

      const previousStock = material.currentStock;
      material.currentStock -= requiredQty;

      const movement = {
        type: "consumption",
        quantity: requiredQty,
        unit: material.unit,
        previousStock,
        newStock: material.currentStock,
        referenceType: "prep_request",
        referenceId: prepRequest._id,
        referenceModel: "PrepRequest",
        foodItemId: foodItem._id,
        foodItemName: foodItem.name,
        quantityProduced: quantityToPrepare,
        performedBy: req.user.id,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        notes: notes || `Consumed for ${quantityToPrepare} x ${foodItem.name}`,
        createdAt: new Date()
      };

      material.stockMovements.push(movement);
      await material.save({ session });

      consumed.push({
        materialId: material._id,
        name: material.name,
        quantityConsumed: requiredQty,
        unit: material.unit,
        previousStock,
        newStock: material.currentStock,
        consumedAt: new Date()
      });
    }

    if (errors.length > 0) {
      throw new Error(errors.join('\n'));
    }

    // Update prep request
    prepRequest.rawMaterialsConsumed = consumed;
    prepRequest.materialsConsumedAt = new Date();
    await prepRequest.save({ session });

    await session.commitTransaction();

    res.json({
      ok: true,
      message: "Raw materials consumed successfully",
      consumed,
      prepRequest: {
        _id: prepRequest._id,
        status: prepRequest.status,
        materialsConsumedAt: prepRequest.materialsConsumedAt
      }
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("Consume materials error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

/**
 * POST /api/raw-materials/bulk-purchase
 * Add stock for multiple materials
 */
router.post("/bulk-purchase", auth, requireRole(["superadmin", "supervisor"]), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { items, supplier, invoiceNo, notes } = req.body;

    const results = [];

    for (const item of items) {
      const { materialId, quantity, costPerUnit } = item;

      const material = await RawMaterial.findById(materialId).session(session);
      
      if (!material) {
        throw new Error(`Material ${materialId} not found`);
      }

      const previousStock = material.currentStock;
      material.currentStock += quantity;

      if (costPerUnit) {
        material.lastPurchaseCost = costPerUnit;
        material.lastPurchaseDate = new Date();
        material.lastPurchaseSupplier = supplier;
        
        // Update average cost
        const totalValue = (material.averageCost * previousStock) + (costPerUnit * quantity);
        material.averageCost = totalValue / material.currentStock;
      }

      const movement = {
        type: "purchase",
        quantity,
        unit: material.unit,
        previousStock,
        newStock: material.currentStock,
        costPerUnit,
        totalCost: costPerUnit ? costPerUnit * quantity : undefined,
        supplier,
        invoiceNo,
        notes,
        performedBy: req.user.id,
        performedByName: req.user.name,
        createdAt: new Date()
      };

      material.stockMovements.push(movement);
      await material.save({ session });

      results.push({
        materialId: material._id,
        name: material.name,
        previousStock,
        newStock: material.currentStock,
        quantity
      });
    }

    await session.commitTransaction();

    res.json({
      ok: true,
      message: "Bulk purchase completed",
      items: results
    });

  } catch (err) {
    await session.abortTransaction();
    console.error("Bulk purchase error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

/**
 * GET /api/raw-materials/low-stock-alerts
 * Get all low stock materials
 */
router.get("/low-stock-alerts", auth, async (req, res) => {
  try {
    const materials = await RawMaterial.find({
      isDeleted: false,
      $expr: { $lt: ["$currentStock", "$minimumStock"] }
    }).lean();

    const alerts = materials.map(m => ({
      _id: m._id,
      name: m.name,
      currentStock: m.currentStock,
      minimumStock: m.minimumStock,
      unit: m.unit,
      shortage: m.minimumStock - m.currentStock,
      reorderQuantity: m.maximumStock - m.currentStock,
      category: m.category,
      preferredSupplier: m.preferredSupplier
    }));

    res.json({
      ok: true,
      count: alerts.length,
      alerts
    });

  } catch (err) {
    console.error("Low stock alerts error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/raw-materials/:id/history
 * Get stock movement history
 */
router.get("/:id/history", auth, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    
    const material = await RawMaterial.findById(req.params.id)
      .select("name unit currentStock stockMovements")
      .lean();

    if (!material || material.isDeleted) {
      return res.status(404).json({ error: "Material not found" });
    }

    let movements = material.stockMovements || [];
    
    movements = movements
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, Number(limit));

    res.json({
      ok: true,
      materialName: material.name,
      unit: material.unit,
      currentStock: material.currentStock,
      history: movements
    });

  } catch (err) {
    console.error("Get history error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;