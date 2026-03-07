import { verifyToken } from "../utils/jwt.js";
import { User } from "../models/User.js";

export async function auth(req, res, next) {
  const hdr = req.headers.authorization || "";
  const m = hdr.match(/^Bearer (.+)$/i);
  if (!m) return res.status(401).json({ error: "Missing Bearer token" });
  try {
    const payload = verifyToken(m[1]);
    const user = await User.findById(payload.id);  // ← REMOVED .lean()
    if (!user) return res.status(401).json({ error: "Invalid token" });
    req.user = { id: user._id, email: user.email, name: user.name, role: user.role };
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}
