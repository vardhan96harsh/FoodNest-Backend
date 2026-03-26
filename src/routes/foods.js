import express from "express";
import path from "path";
import fs from "fs";
import { FoodItem } from "../models/FoodItem.js";
import { uploadFoodImage, FOOD_UPLOAD_SUBDIR } from "../middleware/upload.js";

const router = express.Router();

// Build absolute URL for a stored file
function makePublicUrl(req, relPath) {
  // For production (Render), use the BASE_URL from env
  if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
    const base = process.env.BASE_URL || `https://${req.get('host')}`;
    const cleanPath = relPath.replace(/^\/+/, '');
    const baseClean = base.replace(/\/$/, '');
    return `${baseClean}/uploads/${cleanPath}`;
  }
  
  // For development (localhost)
  const base = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
  const cleanPath = relPath.replace(/^\/+/, '');
  const baseClean = base.replace(/\/$/, '');
  const url = `${baseClean}/uploads/${cleanPath}`;
  console.log("🔗 Generated URL:", url);
  return url;
}

// Parse rawMaterials
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

// Parse quantity object
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
  try {
    const docs = await FoodItem.find().sort({ createdAt: -1 }).lean();
    
    console.log(`📦 Found ${docs.length} food items`);

    const fixed = docs.map(d => {
      // Construct image URL if needed
      let imageUrl = d.imageUrl;
      
      if (!imageUrl && d.imagePath) {
        const base = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
        const baseClean = base.replace(/\/$/, '');
        const cleanPath = d.imagePath.replace(/^\/+/, '');
        imageUrl = `${baseClean}/uploads/${cleanPath}`;
      }
      
      return {
        ...d,
        imageUrl: imageUrl || null,
        imagePath: d.imagePath || null,
      };
    });

    // Log first item for debugging
    if (fixed.length > 0) {
      console.log("📸 Sample item:", {
        name: fixed[0].name,
        imageUrl: fixed[0].imageUrl,
        imagePath: fixed[0].imagePath
      });
    }

    res.json(fixed);
  } catch (error) {
    console.error("❌ GET foods error:", error);
    res.status(500).json({ error: "Failed to fetch food items" });
  }
});

/**
 * GET /api/foods/:id
 */
router.get("/:id", async (req, res) => {
  try {
    const doc = await FoodItem.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: "Food item not found" });
    }
    
    const response = doc.toObject();
    if (doc.imagePath && !doc.imageUrl) {
      const base = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
      const baseClean = base.replace(/\/$/, '');
      const cleanPath = doc.imagePath.replace(/^\/+/, '');
      response.imageUrl = `${baseClean}/uploads/${cleanPath}`;
    }
    
    res.json(response);
  } catch (error) {
    console.error("❌ GET food error:", error);
    res.status(500).json({ error: "Failed to fetch food item" });
  }
});

/**
 * POST /api/foods
 */
// router.post("/", uploadFoodImage.single("image"), async (req, res) => {
//   try {
//     const { name, price, category, available = true, tax = 0 } = req.body;

   
//     if (!name || !price || !category) {
//       return res.status(400).json({ 
//         error: "Missing required fields: name, price, and category are required" 
//       });
//     }

//     const rawMaterials = parseRawMaterials(req.body.rawMaterials);
//     const totalQuantityI = parseQuantity(req.body.totalQuantity);
//     const perServingI = parseQuantity(req.body.perServing);

//     console.log("📝 [POST] Creating new food item:", { name, price, category });

//     let imagePath = null;
//     let imageUrl = null;

//     if (req.file) {
//       imagePath = path.posix.join(FOOD_UPLOAD_SUBDIR, req.file.filename);
//       imageUrl = makePublicUrl(req, imagePath);
//       console.log("📸 [POST] Image saved:", { imagePath, imageUrl });
      
    
//       const fullPath = path.join(process.cwd(), "uploads", imagePath);
//       if (fs.existsSync(fullPath)) {
//         console.log("✅ [POST] File exists on disk:", fullPath);
//       } else {
//         console.log("❌ [POST] File NOT found on disk:", fullPath);
//       }
//     }

//     const doc = await FoodItem.create({
//       name,
//       price: Number(price),
//       category,
//       available: String(available) === "true" || available === true,
//       tax: tax === "" ? 0 : Number(tax),
//       imagePath,
//       imageUrl,
//       rawMaterials,
//       ...(totalQuantityI ? {
//         totalQuantity: {
//           amount: totalQuantityI.amount != null ? Number(totalQuantityI.amount) : undefined,
//           unit: totalQuantityI.unit || undefined,
//         },
//       } : {}),
//       ...(perServingI ? {
//         perServing: {
//           amount: perServingI.amount != null ? Number(perServingI.amount) : undefined,
//           unit: perServingI.unit || undefined,
//         },
//       } : {}),
//     });

//     console.log("✅ [POST] Food item created successfully:", doc._id);
//     res.status(201).json(doc);
//   } catch (e) {
//     console.error("❌ Create food error:", e);
//     res.status(500).json({ error: "Failed to create food item" });
//   }
// });

/**
 * POST /api/foods
 */
router.post("/", uploadFoodImage.single("image"), async (req, res) => {
  try {
    const { name, price, category, available = true, tax = 0, isPermanent = false } = req.body;

    // Validate required fields
    if (!name || !price || !category) {
      return res.status(400).json({ 
        error: "Missing required fields: name, price, and category are required" 
      });
    }

    const rawMaterials = parseRawMaterials(req.body.rawMaterials);
    const totalQuantityI = parseQuantity(req.body.totalQuantity);
    const perServingI = parseQuantity(req.body.perServing);

    console.log("📝 [POST] Creating new food item:", { name, price, category });

    let imagePath = null;
    let imageUrl = null;

    if (req.file) {
      imagePath = path.posix.join(FOOD_UPLOAD_SUBDIR, req.file.filename);
      imageUrl = makePublicUrl(req, imagePath);
      console.log("📸 [POST] Image saved:", { imagePath, imageUrl });
      
      // Verify file was saved
      const fullPath = path.join(process.cwd(), "uploads", imagePath);
      if (fs.existsSync(fullPath)) {
        console.log("✅ [POST] File exists on disk:", fullPath);
      } else {
        console.log("❌ [POST] File NOT found on disk:", fullPath);
      }
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
      isPermanent: String(isPermanent) === "true" || isPermanent === true,  // Handle the `isPermanent` field
      ...(totalQuantityI ? {
        totalQuantity: {
          amount: totalQuantityI.amount != null ? Number(totalQuantityI.amount) : undefined,
          unit: totalQuantityI.unit || undefined,
        },
      } : {}),
      ...(perServingI ? {
        perServing: {
          amount: perServingI.amount != null ? Number(perServingI.amount) : undefined,
          unit: perServingI.unit || undefined,
        },
      } : {}),
    });

    console.log("✅ [POST] Food item created successfully:", doc._id);
    res.status(201).json(doc);
  } catch (e) {
    console.error("❌ Create food error:", e);
    res.status(500).json({ error: "Failed to create food item" });
  }
});


/**
 * PATCH /api/foods/:id
 */


// router.patch(
//   "/:id",
//   (req, res, next) => {
//     const ct = req.headers["content-type"] || "";
//     if (ct.startsWith("multipart/form-data")) {
//       return uploadFoodImage.single("image")(req, res, next);
//     }
//     next();
//   },
//   async (req, res) => {
//     try {
//       const id = req.params.id;
//       const doc = await FoodItem.findById(id);
//       if (!doc) return res.status(404).json({ error: "Not found" });

//       console.log("📝 [PATCH] Updating food item:", id);

//       const fields = {};

//       if (typeof req.body.name !== "undefined") fields.name = req.body.name;
//       if (typeof req.body.price !== "undefined")
//         fields.price = Number(req.body.price);
//       if (typeof req.body.category !== "undefined")
//         fields.category = req.body.category;
//       if (typeof req.body.tax !== "undefined" && req.body.tax !== "")
//         fields.tax = Number(req.body.tax);
//       if (typeof req.body.available !== "undefined") {
//         fields.available =
//           String(req.body.available) === "true" || req.body.available === true;
//       }

     
//       if (typeof req.body.rawMaterials !== "undefined") {
//         fields.rawMaterials = parseRawMaterials(req.body.rawMaterials);
//       }

     
//       if (typeof req.body.totalQuantity !== "undefined") {
//         const tq = parseQuantity(req.body.totalQuantity);
//         fields.totalQuantity = tq
//           ? {
//               amount: tq.amount != null ? Number(tq.amount) : undefined,
//               unit: tq.unit || undefined,
//             }
//           : undefined;
//       }
//       if (typeof req.body.perServing !== "undefined") {
//         const ps = parseQuantity(req.body.perServing);
//         fields.perServing = ps
//           ? {
//               amount: ps.amount != null ? Number(ps.amount) : undefined,
//               unit: ps.unit || undefined,
//             }
//           : undefined;
//       }

   
//       if (req.file) {
//         const newRel = path.posix.join(FOOD_UPLOAD_SUBDIR, req.file.filename);
//         const newUrl = makePublicUrl(req, newRel);

//         console.log("📸 [PATCH] New image uploaded:", { newRel, newUrl });

        
//         if (doc.imagePath) {
//           const absOld = path.join(process.cwd(), "uploads", doc.imagePath);
//           try {
//             if (fs.existsSync(absOld)) {
//               await fs.promises.unlink(absOld);
//               console.log("🗑️ [PATCH] Deleted old image:", doc.imagePath);
//             }
//           } catch (err) {
//             console.log("⚠️ [PATCH] Could not delete old image:", err.message);
//           }
//         }

//         fields.imagePath = newRel;
//         fields.imageUrl = newUrl;
//       }

//       Object.assign(doc, fields);
//       await doc.save();

//       console.log("✅ [PATCH] Food item updated successfully");
//       res.json(doc);
//     } catch (e) {
//       console.error("❌ Update food error:", e);
//       res.status(500).json({ error: "Failed to update food item" });
//     }
//   }
// );

/**
 * PATCH /api/foods/:id
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

      console.log("📝 [PATCH] Updating food item:", id);

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

      // Update the `isPermanent` field
      if (typeof req.body.isPermanent !== "undefined") {
        fields.isPermanent =
          String(req.body.isPermanent) === "true" || req.body.isPermanent === true;
      }

      // rawMaterials
      if (typeof req.body.rawMaterials !== "undefined") {
        fields.rawMaterials = parseRawMaterials(req.body.rawMaterials);
      }

      // quantities
      if (typeof req.body.totalQuantity !== "undefined") {
        const tq = parseQuantity(req.body.totalQuantity);
        fields.totalQuantity = tq
          ? {
              amount: tq.amount != null ? Number(tq.amount) : undefined,
              unit: tq.unit || undefined,
            }
          : undefined;
      }
      if (typeof req.body.perServing !== "undefined") {
        const ps = parseQuantity(req.body.perServing);
        fields.perServing = ps
          ? {
              amount: ps.amount != null ? Number(ps.amount) : undefined,
              unit: ps.unit || undefined,
            }
          : undefined;
      }

      // handle new image
      if (req.file) {
        const newRel = path.posix.join(FOOD_UPLOAD_SUBDIR, req.file.filename);
        const newUrl = makePublicUrl(req, newRel);

        console.log("📸 [PATCH] New image uploaded:", { newRel, newUrl });

        // Delete old image if exists
        if (doc.imagePath) {
          const absOld = path.join(process.cwd(), "uploads", doc.imagePath);
          try {
            if (fs.existsSync(absOld)) {
              await fs.promises.unlink(absOld);
              console.log("🗑️ [PATCH] Deleted old image:", doc.imagePath);
            }
          } catch (err) {
            console.log("⚠️ [PATCH] Could not delete old image:", err.message);
          }
        }

        fields.imagePath = newRel;
        fields.imageUrl = newUrl;
      }

      Object.assign(doc, fields);
      await doc.save();

      console.log("✅ [PATCH] Food item updated successfully");
      res.json(doc);
    } catch (e) {
      console.error("❌ Update food error:", e);
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
    console.log("🗑️ [DELETE] Deleting food item:", id);
    
    const doc = await FoodItem.findByIdAndDelete(id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    // Delete associated image if exists
    if (doc?.imagePath) {
      const abs = path.join(process.cwd(), "uploads", doc.imagePath);
      try {
        if (fs.existsSync(abs)) {
          await fs.promises.unlink(abs);
          console.log("🗑️ [DELETE] Deleted associated image:", doc.imagePath);
        }
      } catch (err) {
        console.log("⚠️ [DELETE] Could not delete image:", err.message);
      }
    }

    console.log("✅ [DELETE] Food item deleted successfully");
    res.json({ message: "Food item deleted successfully" });
  } catch (e) {
    console.error("❌ Delete food error:", e);
    res.status(500).json({ error: "Failed to delete food item" });
  }
});

// Debug endpoint to check file system
router.get("/debug/check-file/:filename", async (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(process.cwd(), "uploads", FOOD_UPLOAD_SUBDIR, filename);
  
  const exists = fs.existsSync(filePath);
  const info = {
    filename,
    filePath,
    exists,
    cwd: process.cwd(),
    uploadsDir: path.join(process.cwd(), "uploads"),
    fullPath: filePath
  };
  
  if (exists) {
    const stats = fs.statSync(filePath);
    info.size = stats.size;
    info.created = stats.birthtime;
  }
  
  console.log("🔍 File check:", info);
  res.json(info);
});

export default router;