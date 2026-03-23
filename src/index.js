import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";
import passport from "./config/passport.js";
import { connectDB } from "./config/db.js";
import { User } from "./models/User.js";
import session from "express-session";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import foodsRoutes from "./routes/foods.js";
import usersRoutes from "./routes/users.js";
import prepRequestsRoutes from "./routes/prepRequests.js";
import { auth } from "./middleware/auth.js";
import combosRoutes from "./routes/combos.js";
import vehicleRoutes from "./routes/vehicles.js";
import batteryRoutes from "./routes/batteries.js";
import routeRoutes from "./routes/routes.js";
import supervisorRoutes from "./routes/supervisor.js";
import rider from "./routes/rider.js";
import supervisorInventoryRoutes from "./routes/supervisorInventory.js";
import refillRequestsRoutes from "./routes/refillRequests.js";
import auth0Routes from "./routes/auth0.js";
import rawMaterialsRouter from './routes/rawMaterials.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// --- CORS Configuration ---
app.use(cors({
  origin: "*", // Allow all origins for development
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Content-Length", "X-Requested-With"],
  credentials: true,
}));

// --- Helmet with cross-origin settings ---
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "unsafe-none" },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

// --- Serve static files with proper CORS headers ---
const uploadsPath = path.join(process.cwd(), "uploads");
console.log("📁 Serving static files from:", uploadsPath);

// Ensure uploads directory exists
import fs from 'fs';
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
  console.log("✅ Created uploads directory");
}

app.use("/uploads", express.static(uploadsPath, {
  setHeaders: (res, filePath) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=31557600');
    
    // Set correct content type based on file extension
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    if (contentTypes[ext]) {
      res.setHeader('Content-Type', contentTypes[ext]);
    }
  }
}));
app.use(session({
  secret: process.env.SESSION_SECRET || "foodnest-secret",
  resave: false,
  saveUninitialized: false,
}));

app.use(passport.initialize());
app.use(passport.session());

// Mount the route
app.use("/api/auth/auth0", auth0Routes);
// Routes
app.use("/api/foods", foodsRoutes);
app.use("/api/users", auth, usersRoutes);
app.use("/api/prep-requests", auth, prepRequestsRoutes);
app.use("/api/combos", combosRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/batteries", batteryRoutes);

// --- Basic routes ---
app.get("/", (_req, res) => res.send("FoodNest API"));
app.get("/health", (_req, res) =>
  res.json({ ok: true, uptime: process.uptime(), ts: Date.now() })
);

// --- API routes ---
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/routes", routeRoutes);
app.use("/api/supervisor", supervisorRoutes);
app.use("/api/rider", rider);
app.use("/api/supervisor-inventory", supervisorInventoryRoutes);
app.use("/api/refill-requests", refillRequestsRoutes);
app.use('/api/raw-materials', rawMaterialsRouter);

// --- Seed SuperAdmin ---
async function ensureSuperAdmin() {
  const email = (process.env.SUPERADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD || "";
  if (!email || !password) {
    console.warn("⚠️  SUPERADMIN_EMAIL or SUPERADMIN_PASSWORD not set — skipping seed");
    return;
  }

  let user = await User.findOne({ email });
  if (!user) {
    user = new User({ email, name: "Super Admin", role: "superadmin", passwordHash: "x" });
    await user.setPassword(password);
    await user.save();
    console.log(`👑 Seeded SuperAdmin: ${email}`);
  } else {
    if (user.role !== "superadmin") {   
      user.role = "superadmin";
      await user.save();
    }
    console.log(`👑 SuperAdmin exists: ${email}`);
  }
}

// --- Startup ---
const PORT = process.env.PORT || 1900;
const isProduction = process.env.NODE_ENV === 'production';

(async () => {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("Missing MONGODB_URI in .env");

    await connectDB(uri);
    await ensureSuperAdmin();

    app.listen(PORT, () => {
      console.log(`🚀 API running on http://localhost:${PORT}`);
      console.log(`📁 Uploads directory: ${uploadsPath}`);
      console.log(`🔓 CORS enabled for all origins`);
      console.log(`🖼️  Test image: http://localhost:${PORT}/uploads/test.jpg`);
    });
  } catch (err) {
    console.error("DB/Startup error:", err);
    process.exit(1);
  }
})();

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});