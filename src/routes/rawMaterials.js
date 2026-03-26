// routes/rawMaterials.js
import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { RawMaterial } from "../models/RawMaterial.js";
import { FoodItem } from "../models/FoodItem.js";
import { PrepRequest } from "../models/PrepRequest.js";
import mongoose from "mongoose";

const router = express.Router();

// ==================== HELPER FUNCTIONS ====================

const escapeRegex = (str = "") =>
  str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const calculateStockStatus = (current) => {
  if (current <= 0) return "out_of_stock";
  return "available";
};

// ==================== RAW MATERIAL MANAGEMENT ====================

/**
 * GET /api/raw-materials
 * Get all raw materials
 */
router.get("/", auth, async (req, res) => {
  try {
    const { category, search, lowStock } = req.query;

    const query = { isDeleted: false };

    if (category) query.category = category;

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { category: { $regex: search, $options: "i" } },
      ];
    }

    const materials = await RawMaterial.find(query).sort({ name: 1 }).lean();

    const enhancedMaterials = materials.map((m) => ({
      ...m,
      stockStatus: calculateStockStatus(m.currentStock),
      stockValue: (m.currentStock || 0) * (m.averageCost || 0),
    }));

    let result = enhancedMaterials;
    if (lowStock === "true") {
      result = result.filter((m) => m.currentStock <= 0);
    }

    res.json({
      ok: true,
      items: result,
      summary: {
        totalItems: result.length,
        outOfStockCount: result.filter((m) => m.currentStock <= 0).length,
      },
    });
  } catch (err) {
    console.error("Get raw materials error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/raw-materials/from-food-items
 * Get all unique raw materials that appear in any food item.
 * Returns an array of { name, unit, count }.
 */
router.get("/from-food-items", auth, async (req, res) => {
  try {
    const materialsFromFood = await FoodItem.aggregate([
      { $unwind: { path: "$rawMaterials", preserveNullAndEmptyArrays: false } },
      {
        $group: {
          _id: {
            name: { $toLower: "$rawMaterials.name" },
            unit: "$rawMaterials.unit",
          },
          name: { $first: "$rawMaterials.name" },
          unit: { $first: "$rawMaterials.unit" },
          count: { $sum: 1 },
        },
      },
      { $sort: { name: 1 } },
      { $project: { _id: 0, name: 1, unit: 1, count: 1 } },
    ]);

    res.json({
      ok: true,
      materials: materialsFromFood,
    });
  } catch (err) {
    console.error("Error fetching raw materials from food items:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/raw-materials
 * Add stock from food-item raw material list.
 *
 * Expected body:
 * {
 *   "name": "Tomato",
 *   "qty": 5,
 *   "averageCost": 20,
 *   "preferredSupplier": "ABC Supplier",
 *   "initialStockDate": "2026-03-23T10:00:00.000Z"
 * }
 *
 * Flow:
 * - name must come from FoodItem.rawMaterials
 * - if raw material already exists in inventory => add qty
 * - if not exists => create raw material in inventory and set qty
 */
router.post("/", auth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { name, qty, averageCost = 0, preferredSupplier, initialStockDate } =
      req.body;

    if (!name || !name.trim()) {
      throw new Error("Raw material name is required");
    }

    const parsedQty = Number(qty);
    const parsedAverageCost = Number(averageCost || 0);

    if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
      throw new Error("qty must be a valid number greater than 0");
    }

    if (!Number.isFinite(parsedAverageCost) || parsedAverageCost < 0) {
      throw new Error(
        "averageCost must be a valid number greater than or equal to 0"
      );
    }

    const stockDate = initialStockDate ? new Date(initialStockDate) : new Date();
    if (isNaN(stockDate.getTime())) {
      throw new Error("initialStockDate is invalid");
    }

    const safeName = escapeRegex(name.trim());

    // Find selected raw material from FoodItem.rawMaterials
    const materialFromFood = await FoodItem.aggregate([
      { $unwind: "$rawMaterials" },
      {
        $match: {
          "rawMaterials.name": { $regex: new RegExp(`^${safeName}$`, "i") },
        },
      },
      {
        $group: {
          _id: { $toLower: "$rawMaterials.name" },
          name: { $first: "$rawMaterials.name" },
          unit: { $first: "$rawMaterials.unit" },
        },
      },
      { $limit: 1 },
    ]).session(session);

    if (!materialFromFood.length) {
      throw new Error("Selected raw material was not found in food items");
    }

    const selectedMaterial = materialFromFood[0];
    const selectedSafeName = escapeRegex(selectedMaterial.name);

    // Check existing inventory
    const existing = await RawMaterial.findOne({
      name: { $regex: new RegExp(`^${selectedSafeName}$`, "i") },
      isDeleted: false,
    }).session(session);

    // Already exists => add stock only
    if (existing) {
      const previousStock = existing.currentStock || 0;
      existing.currentStock = previousStock + parsedQty;

      existing.stockMovements.push({
        type: "purchase",
        quantity: parsedQty,
        unit: existing.unit || selectedMaterial.unit || "unit",
        previousStock,
        newStock: existing.currentStock,
        costPerUnit: parsedAverageCost,
        totalCost: parsedAverageCost * parsedQty,
        supplier: preferredSupplier,
        notes: "Stock added from food item raw material list",
        performedBy: req.user.id,
        performedByName: req.user.name,
        createdAt: stockDate,
      });

      if (!existing.unit && selectedMaterial.unit) {
        existing.unit = selectedMaterial.unit;
      }

      if (preferredSupplier) {
        existing.preferredSupplier = preferredSupplier;
      }

      if (parsedAverageCost > 0) {
        existing.lastPurchaseCost = parsedAverageCost;
        existing.averageCost = parsedAverageCost;
        existing.lastPurchaseDate = stockDate;
      }

      await existing.save({ session });
      await session.commitTransaction();

      return res.json({
        ok: true,
        message: "Stock added successfully",
        material: existing,
      });
    }

    // Not exists => create inventory item from food item material
    const stockMovements = [
      {
        type: "purchase",
        quantity: parsedQty,
        unit: selectedMaterial.unit || "unit",
        previousStock: 0,
        newStock: parsedQty,
        costPerUnit: parsedAverageCost,
        totalCost: parsedAverageCost * parsedQty,
        supplier: preferredSupplier,
        notes: "Created from food item raw material list",
        performedBy: req.user.id,
        performedByName: req.user.name,
        createdAt: stockDate,
      },
    ];

    const material = await RawMaterial.create(
      [
        {
          name: selectedMaterial.name,
          unit: selectedMaterial.unit || "unit",
          category: "Other",
          currentStock: parsedQty,
          preferredSupplier,
          averageCost: parsedAverageCost,
          lastPurchaseCost: parsedAverageCost,
          lastPurchaseDate: stockDate,
          stockMovements,
          createdBy: req.user.id,
        },
      ],
      { session }
    );

    await session.commitTransaction();

    res.status(201).json({
      ok: true,
      message: "Raw material added to inventory successfully",
      material: material[0],
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Add stock from food material list error:", err);
    res.status(400).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

/**
 * PATCH /api/raw-materials/:id
 * Update raw material details only (not stock)
 */
router.patch("/:id", auth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedUpdates = [
      "name",
      "category",
      "unit",
      "preferredSupplier",
      "alternateSupplier",
      "supplierContact",
      "averageCost",
      "status",
    ];

    const updateData = {};
    for (const field of allowedUpdates) {
      if (updates[field] !== undefined) {
        updateData[field] = updates[field];
      }
    }

    if (updateData.name) {
      const safeName = escapeRegex(updateData.name.trim());
      const existing = await RawMaterial.findOne({
        name: { $regex: new RegExp(`^${safeName}$`, "i") },
        _id: { $ne: id },
        isDeleted: false,
      }).session(session);

      if (existing) {
        throw new Error("A raw material with this name already exists");
      }

      updateData.name = updateData.name.trim();
    }

    const material = await RawMaterial.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { $set: { ...updateData, updatedBy: req.user.id } },
      { new: true, runValidators: true, session }
    );

    if (!material) {
      throw new Error("Raw material not found");
    }

    await session.commitTransaction();

    res.json({
      ok: true,
      material,
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Update raw material error:", err);
    res.status(400).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

/**
 * DELETE /api/raw-materials/:id
 * Soft delete a raw material
 */
router.delete("/:id", auth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    const material = await RawMaterial.findById(id).session(session);
    if (!material || material.isDeleted) {
      throw new Error("Raw material not found");
    }

    material.isDeleted = true;
    material.deletedAt = new Date();
    material.deletedBy = req.user.id;
    material.status = "discontinued";

    await material.save({ session });

    await session.commitTransaction();

    res.json({
      ok: true,
      message: "Raw material deleted successfully",
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Delete raw material error:", err);
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
        message: "No raw materials required",
      });
    }

    const availability = [];
    let allAvailable = true;

    for (const rm of foodItem.rawMaterials) {
      const requiredQty = (rm.qty || 1) * quantity;
      const safeName = escapeRegex(rm.name);

      const material = await RawMaterial.findOne({
        name: { $regex: new RegExp(`^${safeName}$`, "i") },
        isDeleted: false,
      });

      if (!material) {
        allAvailable = false;
        availability.push({
          name: rm.name,
          required: requiredQty,
          unit: rm.unit || "unit",
          available: 0,
          status: "not_found",
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
        status: isAvailable ? "available" : "insufficient",
        remainingAfter: material.currentStock - requiredQty,
      });
    }

    res.json({
      ok: true,
      available: allAvailable,
      materials: availability,
      canProduce: allAvailable ? quantity : 0,
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
router.post(
  "/consume-for-prep-request",
  auth,
  requireRole(["supervisor", "cook"]),
  async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { prepRequestId, notes } = req.body;

      const prepRequest = await PrepRequest.findById(prepRequestId)
        .populate("foodId")
        .session(session);

      if (!prepRequest) {
        throw new Error("Prep request not found");
      }

      if (prepRequest.status !== "processing") {
        throw new Error("Prep request must be in processing state");
      }

      if (
        prepRequest.rawMaterialsConsumed &&
        prepRequest.rawMaterialsConsumed.length > 0
      ) {
        throw new Error("Materials already consumed for this request");
      }

      const foodItem = prepRequest.foodId;
      const quantityToPrepare = prepRequest.quantityToPrepare || 1;

      if (!foodItem.rawMaterials || foodItem.rawMaterials.length === 0) {
        prepRequest.materialsConsumedAt = new Date();
        await prepRequest.save({ session });
        await session.commitTransaction();

        return res.json({
          ok: true,
          message: "No raw materials to consume",
          consumed: [],
        });
      }

      const consumed = [];
      const errors = [];
      const consumedAt = new Date();

      for (const rm of foodItem.rawMaterials) {
        const requiredQty = (rm.qty || 1) * quantityToPrepare;
        const safeName = escapeRegex(rm.name);

        const material = await RawMaterial.findOne({
          name: { $regex: new RegExp(`^${safeName}$`, "i") },
          isDeleted: false,
        }).session(session);

        if (!material) {
          errors.push(`Raw material '${rm.name}' not found`);
          continue;
        }

        if (material.currentStock < requiredQty) {
          errors.push(
            `Insufficient ${material.name}. Required: ${requiredQty} ${material.unit}, Available: ${material.currentStock} ${material.unit}`
          );
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
          createdAt: consumedAt,
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
          consumedAt,
        });
      }

      if (errors.length > 0) {
        throw new Error(errors.join("\n"));
      }

      prepRequest.rawMaterialsConsumed = consumed;
      prepRequest.materialsConsumedAt = consumedAt;
      await prepRequest.save({ session });

      await session.commitTransaction();

      res.json({
        ok: true,
        message: "Raw materials consumed successfully",
        consumed,
        prepRequest: {
          _id: prepRequest._id,
          status: prepRequest.status,
          materialsConsumedAt: prepRequest.materialsConsumedAt,
        },
      });
    } catch (err) {
      await session.abortTransaction();
      console.error("Consume materials error:", err);
      res.status(500).json({ error: err.message });
    } finally {
      session.endSession();
    }
  }
);

/**
 * POST /api/raw-materials/bulk-purchase
 * Add stock for multiple materials
 */
router.post(
  "/bulk-purchase",
  auth,
  requireRole(["superadmin", "supervisor"]),
  async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { items, supplier, invoiceNo, notes } = req.body;

      const results = [];

      for (const item of items) {
        const { materialId, quantity, costPerUnit } = item;

        const material = await RawMaterial.findById(materialId).session(session);
        if (!material || material.isDeleted) {
          throw new Error(`Material ${materialId} not found`);
        }

        const previousStock = material.currentStock || 0;
        material.currentStock += quantity;

        if (costPerUnit !== undefined && costPerUnit !== null) {
          material.lastPurchaseCost = costPerUnit;
          material.lastPurchaseDate = new Date();
          material.lastPurchaseSupplier = supplier;

          const totalValue =
            (material.averageCost || 0) * previousStock + costPerUnit * quantity;
          material.averageCost =
            material.currentStock > 0 ? totalValue / material.currentStock : 0;
        }

        const movement = {
          type: "purchase",
          quantity,
          unit: material.unit,
          previousStock,
          newStock: material.currentStock,
          costPerUnit,
          totalCost:
            costPerUnit !== undefined && costPerUnit !== null
              ? costPerUnit * quantity
              : undefined,
          supplier,
          invoiceNo,
          notes,
          performedBy: req.user.id,
          performedByName: req.user.name,
          createdAt: new Date(),
        };

        material.stockMovements.push(movement);
        await material.save({ session });

        results.push({
          materialId: material._id,
          name: material.name,
          previousStock,
          newStock: material.currentStock,
          quantity,
        });
      }

      await session.commitTransaction();

      res.json({
        ok: true,
        message: "Bulk purchase completed",
        items: results,
      });
    } catch (err) {
      await session.abortTransaction();
      console.error("Bulk purchase error:", err);
      res.status(500).json({ error: err.message });
    } finally {
      session.endSession();
    }
  }
);

/**
 * GET /api/raw-materials/low-stock-alerts
 * For your current flow without minimum/maximum,
 * treat currentStock <= 0 as alert
 */
router.get("/low-stock-alerts", auth, async (req, res) => {
  try {
    const materials = await RawMaterial.find({
      isDeleted: false,
      currentStock: { $lte: 0 },
    }).lean();

    const alerts = materials.map((m) => ({
      _id: m._id,
      name: m.name,
      currentStock: m.currentStock,
      unit: m.unit,
      category: m.category,
      preferredSupplier: m.preferredSupplier,
    }));

    res.json({
      ok: true,
      count: alerts.length,
      alerts,
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
      .select("name unit currentStock stockMovements isDeleted")
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
      history: movements,
    });
  } catch (err) {
    console.error("Get history error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * PATCH /api/raw-materials/:id/stock
 * Add more stock to an existing raw material by qty
 *
 * Expected body:
 * {
 *   "qty": 3,
 *   "reason": "restock",
 *   "notes": "added more stock",
 *   "averageCost": 25
 * }
 */
router.patch("/:id/stock", auth, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { qty, reason, notes, averageCost } = req.body;

    const parsedQty = Number(qty);
    const parsedAverageCost =
      averageCost !== undefined ? Number(averageCost) : undefined;

    if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
      throw new Error("qty is required and must be a number greater than 0");
    }

    if (
      parsedAverageCost !== undefined &&
      (!Number.isFinite(parsedAverageCost) || parsedAverageCost < 0)
    ) {
      throw new Error(
        "averageCost must be a valid number greater than or equal to 0"
      );
    }

    const material = await RawMaterial.findById(id).session(session);
    if (!material || material.isDeleted) {
      throw new Error("Raw material not found");
    }

    const previousStock = material.currentStock || 0;
    material.currentStock = previousStock + parsedQty;

    const movement = {
      type: "purchase",
      quantity: parsedQty,
      unit: material.unit,
      previousStock,
      newStock: material.currentStock,
      costPerUnit: parsedAverageCost,
      totalCost:
        parsedAverageCost !== undefined ? parsedAverageCost * parsedQty : undefined,
      notes: notes || reason || `Stock added: ${parsedQty}`,
      performedBy: req.user.id,
      performedByName: req.user.name,
      performedByRole: req.user.role,
      createdAt: new Date(),
    };

    material.stockMovements.push(movement);

    if (parsedAverageCost !== undefined) {
      material.lastPurchaseCost = parsedAverageCost;
      material.averageCost = parsedAverageCost;
      material.lastPurchaseDate = new Date();
    }

    await material.save({ session });
    await session.commitTransaction();

    res.json({
      ok: true,
      message: "Stock added successfully",
      material: {
        _id: material._id,
        name: material.name,
        previousStock,
        newStock: material.currentStock,
        unit: material.unit,
      },
      movement,
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Add stock by id error:", err);
    res.status(400).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

export default router;