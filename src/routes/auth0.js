import express from "express";
import passport from "../config/passport.js";
import { signToken } from "../utils/jwt.js";

const router = express.Router();

router.get("/login", passport.authenticate("auth0", {
  scope: "openid profile email",
  connection: "google-oauth2",
  prompt: "select_account", // ← forces account picker every time
}));

router.get("/callback",
  passport.authenticate("auth0", { session: false, failureRedirect: "/" }),
  (req, res) => {
    const user = req.user;

    // Pending approval — redirect with pending status
    if (user.status === "pending") {
      const name  = encodeURIComponent(user.name || "");
      const email = encodeURIComponent(user.email || "");
      return res.redirect(
        `foodnestnative://auth/callback?status=pending&name=${name}&email=${email}`
      );
    }

    // Approved — redirect with token
    const token = signToken(user);
    const encodedUser = encodeURIComponent(JSON.stringify({
      id:    user._id,
      name:  user.name,
      email: user.email,
      role:  user.role,
    }));
    return res.redirect(
      `foodnestnative://auth/callback?status=approved&token=${token}&user=${encodedUser}`
    );
  }
);

export default router;