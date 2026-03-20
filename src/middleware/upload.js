import multer from "multer";
import path from "path";
import fs from "fs";

const UPLOAD_ROOT = path.resolve("uploads");
const FOOD_SUBDIR = "foods";
const FOOD_DIR = path.join(UPLOAD_ROOT, FOOD_SUBDIR);

// Export the FOOD_SUBDIR constant
export const FOOD_UPLOAD_SUBDIR = FOOD_SUBDIR;

console.log("📁 Upload directory:", FOOD_DIR);

// Make sure folders exist
try {
  fs.mkdirSync(FOOD_DIR, { recursive: true });
  console.log("✅ Upload directory created/verified");
} catch (err) {
  console.error("❌ Error creating upload directory:", err);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, FOOD_DIR);
  },
  filename: (_req, file, cb) => {
    // Clean filename
    const ext = path.extname(file.originalname || ".jpg").toLowerCase();
    const base = path.basename(file.originalname || "image", ext)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .slice(0, 40);
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const filename = `${base || "food"}-${unique}${ext}`;
    console.log("📸 Saving image as:", filename);
    cb(null, filename);
  },
});

const fileFilter = (_req, file, cb) => {
  console.log("📁 File filter - mimetype:", file.mimetype, "name:", file.originalname);
  
  // Allow common image types
  const allowedMimes = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
  
  if (allowedMimes.includes(file.mimetype)) {
    console.log("✅ File accepted");
    return cb(null, true);
  }
  
  console.log("❌ File rejected - not an image");
  cb(new Error("Only image files are allowed (JPEG, PNG, WEBP, GIF)"));
};

export const uploadFoodImage = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});