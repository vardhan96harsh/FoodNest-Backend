

import "dotenv/config";  
import passport from "passport";
import { Strategy as Auth0Strategy } from "passport-auth0";
import { User } from "../models/User.js";
console.log("ENV CHECK:", process.env.AUTH0_CLIENT_ID, process.env.AUTH0_DOMAIN);

passport.use(new Auth0Strategy({
  domain: process.env.AUTH0_DOMAIN,
  clientID: process.env.AUTH0_CLIENT_ID,
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
  callbackURL: process.env.AUTH0_CALLBACK_URL,
}, async (accessToken, refreshToken, extraParams, profile, done) => {
  try {
    const email = profile.emails?.[0]?.value;
    if (!email) return done(new Error("No email from Auth0"), null);

    let user = await User.findOne({ email });

    if (!user) {
      user = new User({
        email,
        name: profile.displayName || email,
        role: "rider",           // default role — change as needed
        auth0Id: profile.id,
      });
      await user.save();
    } else if (!user.auth0Id) {
      // Link Auth0 ID to existing user
      user.auth0Id = profile.id;
      await user.save();
    }

    return done(null, user);
  } catch (err) {
    return done(err, null);
  }
}));

// Needed even without sessions — passport-auth0 requires these
passport.serializeUser((user, done) => done(null, user._id));
passport.deserializeUser(async (id, done) => {
  const user = await User.findById(id);
  done(null, user);
});

export default passport;