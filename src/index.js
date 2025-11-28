// src/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import { connectDB } from "./config/db.js";
import { User } from "./models/User.js";

import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";

import path from "path";
import foodsRoutes from "./routes/foods.js";

import usersRoutes from "./routes/users.js";
import prepRequestsRoutes from "./routes/prepRequests.js";
import { auth } from "./middleware/auth.js";
import combosRoutes from "./routes/combos.js";

import vehicleRoutes from "./routes/vehicles.js";
import batteryRoutes from "./routes/batteries.js";
import supervisorRoutes from "./routes/supervisor.routes.js";
import routeRoutes from "./routes/routes.routes.js";



const app = express();

// --- Middlewares ---
app.use(
  cors({
    origin: "*", // dev-friendly; tighten for prod
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(helmet());
app.use(express.json());
app.use(morgan("dev"));

app.use("/uploads", express.static(path.resolve("uploads")));

app.use("/api/foods", foodsRoutes);

// List users (for cooks dropdown)
app.use("/api/users", auth, usersRoutes);

// Prep requests (assignments Supervisor/Superadmin -> Cook)
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

app.use("/api/supervisor", supervisorRoutes);
app.use("/api/routes", routeRoutes);

// --- Seed SuperAdmin (from .env) ---
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
    // ensure role is superadmin (in case it was edited)
    if (user.role !== "superadmin") {   
      user.role = "superadmin";
      await user.save();
    }
    console.log(`👑 SuperAdmin exists: ${email}`);
  }
}

// --- Startup ---
const PORT = process.env.PORT || 1900;

(async () => {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("Missing MONGODB_URI in .env");

    await connectDB(uri);
    await ensureSuperAdmin();

    app.listen(PORT, () => {
      console.log(`🚀 API running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("DB/Startup error:", err);
    process.exit(1);
  }
})();

// Helpful in dev: surface unhandled promise rejections
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});
