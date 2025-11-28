import express from "express";
import path from "path";
import fs from "fs";
import { FoodItem } from "../models/FoodItem.js";
import { uploadFoodImage, FOOD_UPLOAD_SUBDIR } from "../middleware/upload.js";

const router = express.Router();

// Build absolute URL for a stored file
function makePublicUrl(req, relPath) {
  const base = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
  return `${base}/uploads/${relPath}`;
}

// Parse rawMaterials (string from multipart or array from JSON)
function parseRawMaterials(input) {
  if (!input) return [];
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(input) ? input : [];
}

// NEW: Parse quantity object (string or object). Also accept alt keys if needed.
function parseQuantity(input) {
  if (!input) return undefined;
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return parsed && typeof parsed === "object" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return typeof input === "object" ? input : undefined;
}

/**
 * GET /api/foods
 */
router.get("/", async (req, res) => {
  const docs = await FoodItem.find().sort({ createdAt: -1 }).lean();

  const fixed = docs.map(d => ({
    ...d,
    imageUrl: d.imageUrl
      ? d.imageUrl
      : d.imagePath
      ? `${req.protocol}://${req.get("host")}/uploads/${d.imagePath}`
      : null,
  }));

  res.json(fixed);
});


/**
 * POST /api/foods
 * Create item (multipart). Image field name: "image"
 */
router.post("/", uploadFoodImage.single("image"), async (req, res) => {
  try {
    const { name, price, category, available = true, tax = 0 } = req.body;

    const rawMaterials = parseRawMaterials(req.body.rawMaterials);
    const totalQuantityI = parseQuantity(req.body.totalQuantity); // NEW
    const perServingI = parseQuantity(req.body.perServing);       // NEW

    // Debug: confirm what we received
    console.log("[POST /foods] totalQuantity:", req.body.totalQuantity);
    console.log("[POST /foods] perServing:", req.body.perServing);

    let imagePath = null;
    let imageUrl = null;

    if (req.file) {
      imagePath = path.posix.join(FOOD_UPLOAD_SUBDIR, req.file.filename);
      imageUrl = makePublicUrl(req, imagePath);
    }

    const doc = await FoodItem.create({
      name,
      price: Number(price),
      category,
      available: String(available) === "true" || available === true,
      tax: tax === "" ? 0 : Number(tax),
      imagePath,
      imageUrl,
      rawMaterials,

      // NEW: include only if provided
      ...(totalQuantityI
        ? {
            totalQuantity: {
              amount:
                totalQuantityI.amount != null
                  ? Number(totalQuantityI.amount)
                  : undefined,
              unit: totalQuantityI.unit || undefined,
            },
          }
        : {}),
      ...(perServingI
        ? {
            perServing: {
              amount:
                perServingI.amount != null
                  ? Number(perServingI.amount)
                  : undefined,
              unit: perServingI.unit || undefined,
            },
          }
        : {}),
    });

    res.status(201).json(doc);
  } catch (e) {
    console.error("Create food error:", e);
    res.status(500).json({ error: "Failed to create food item" });
  }
});

/**
 * PATCH /api/foods/:id
 * Update item. Accepts either JSON or multipart with optional "image".
 */
router.patch(
  "/:id",
  (req, res, next) => {
    const ct = req.headers["content-type"] || "";
    if (ct.startsWith("multipart/form-data")) {
      return uploadFoodImage.single("image")(req, res, next);
    }
    next();
  },
  async (req, res) => {
    try {
      const id = req.params.id;
      const doc = await FoodItem.findById(id);
      if (!doc) return res.status(404).json({ error: "Not found" });

      const fields = {};

      if (typeof req.body.name !== "undefined") fields.name = req.body.name;
      if (typeof req.body.price !== "undefined")
        fields.price = Number(req.body.price);
      if (typeof req.body.category !== "undefined")
        fields.category = req.body.category;
      if (typeof req.body.tax !== "undefined" && req.body.tax !== "")
        fields.tax = Number(req.body.tax);
      if (typeof req.body.available !== "undefined") {
        fields.available =
          String(req.body.available) === "true" || req.body.available === true;
      }

      // rawMaterials
      if (typeof req.body.rawMaterials !== "undefined") {
        fields.rawMaterials = parseRawMaterials(req.body.rawMaterials);
      }

      // NEW: quantities
      if (typeof req.body.totalQuantity !== "undefined") {
        const tq = parseQuantity(req.body.totalQuantity);
        fields.totalQuantity = tq
          ? {
              amount: tq.amount != null ? Number(tq.amount) : undefined,
              unit: tq.unit || undefined,
            }
          : undefined; // sending empty/invalid clears it
      }
      if (typeof req.body.perServing !== "undefined") {
        const ps = parseQuantity(req.body.perServing);
        fields.perServing = ps
          ? {
              amount: ps.amount != null ? Number(ps.amount) : undefined,
              unit: ps.unit || undefined,
            }
          : undefined; // sending empty/invalid clears it
      }

      // Debug: confirm we parsed them on PATCH
      console.log("[PATCH /foods/:id] totalQuantity:", req.body.totalQuantity);
      console.log("[PATCH /foods/:id] perServing:", req.body.perServing);

      // handle new image
      if (req.file) {
        const newRel = path.posix.join(FOOD_UPLOAD_SUBDIR, req.file.filename);
        const newUrl = makePublicUrl(req, newRel);

        if (doc.imagePath) {
   const absOld = path.join(process.cwd(), "uploads", doc.imagePath);

          fs.promises.unlink(absOld).catch(() => {});
        }

        fields.imagePath = newRel;
        fields.imageUrl = newUrl;
      }

      Object.assign(doc, fields);
      await doc.save();

      res.json(doc);
    } catch (e) {
      console.error("Update food error:", e);
      res.status(500).json({ error: "Failed to update food item" });
    }
  }
);

/**
 * DELETE /api/foods/:id
 */
router.delete("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const doc = await FoodItem.findByIdAndDelete(id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    if (doc?.imagePath) {
   const abs = path.join(process.cwd(), "uploads", doc.imagePath);

      fs.promises.unlink(abs).catch(() => {});
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("Delete food error:", e);
    res.status(500).json({ error: "Failed to delete food item" });
  }
});

export default router;
