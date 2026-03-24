// ─────────────────────────────────────────────────────────────
//  routes/admin.js  — Super Admin REST API
//  Mount in your app.js:  app.use('/api/admin', require('./routes/admin'));
// ─────────────────────────────────────────────────────────────

const express = require("express");
const router  = express.Router();
const User    = require("../models/User"); // adjust path to your User model

// ─────────────────────────────────────────────────────────────
//  ADMIN AUTH MIDDLEWARE
//  Add  ADMIN_SECRET=your-secret-key  to your .env file.
//  The frontend sends it as the  x-admin-key  header.
// ─────────────────────────────────────────────────────────────
const adminAuth = (req, res, next) => {
  const key = req.headers["x-admin-key"];
  if (!key || key !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ success: false, message: "Forbidden: invalid admin key." });
  }
  next();
};

// Apply admin auth to ALL routes in this file
router.use(adminAuth);


// ─────────────────────────────────────────────────────────────
//  GET /api/admin/users
//  Returns all users (safe fields only — no passwords, tokens etc.)
// ─────────────────────────────────────────────────────────────
router.get("/users", async (req, res) => {
  try {
    const users = await User.find({})
      .select(
        "name email contact tokens referralCode referralCount " +
        "createdAt instagramEnabled whatsappEnabled telegramEnabled botConfig.status"
      )
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, count: users.length, users });
  } catch (err) {
    console.error("[Admin] GET /users error:", err);
    return res.status(500).json({ success: false, message: "Server error fetching users." });
  }
});


// ─────────────────────────────────────────────────────────────
//  GET /api/admin/users/:id
//  Returns one user's full profile (still no password)
// ─────────────────────────────────────────────────────────────
router.get("/users/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select("-password -resetPasswordToken -resetPasswordExpires")
      .lean();

    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    return res.json({ success: true, user });
  } catch (err) {
    console.error("[Admin] GET /users/:id error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});


// ─────────────────────────────────────────────────────────────
//  PATCH /api/admin/users/:id/tokens
//  Body: { amount: 500 }     ← adds tokens  (positive number)
//        { amount: -200 }    ← deducts tokens (optional)
//        { set: 1000 }       ← sets tokens to exact value (optional)
// ─────────────────────────────────────────────────────────────
router.patch("/users/:id/tokens", async (req, res) => {
  try {
    const { amount, set } = req.body;

    let update;

    if (typeof set === "number") {
      // Hard-set mode
      if (set < 0) return res.status(400).json({ success: false, message: "Token value cannot be negative." });
      update = { $set: { tokens: set } };

    } else if (typeof amount === "number") {
      // Increment / decrement mode
      if (amount === 0) return res.status(400).json({ success: false, message: "Amount cannot be zero." });

      // Prevent going below 0 — fetch current first
      if (amount < 0) {
        const current = await User.findById(req.params.id).select("tokens").lean();
        if (!current) return res.status(404).json({ success: false, message: "User not found." });
        if ((current.tokens || 0) + amount < 0) {
          return res.status(400).json({ success: false, message: "Insufficient tokens to deduct." });
        }
      }
      update = { $inc: { tokens: amount } };

    } else {
      return res.status(400).json({ success: false, message: "Provide 'amount' (increment) or 'set' (absolute value)." });
    }

    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true })
      .select("name email tokens")
      .lean();

    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    console.log(`[Admin] Tokens updated — ${user.email}: ${user.tokens}`);

    return res.json({
      success: true,
      message: `Tokens updated for ${user.name}.`,
      user: { _id: user._id, name: user.name, email: user.email, tokens: user.tokens },
    });

  } catch (err) {
    console.error("[Admin] PATCH /users/:id/tokens error:", err);
    return res.status(500).json({ success: false, message: "Server error updating tokens." });
  }
});


// ─────────────────────────────────────────────────────────────
//  DELETE /api/admin/users/:id
//  Permanently removes a user from the database
// ─────────────────────────────────────────────────────────────
router.delete("/users/:id", async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id).select("name email").lean();

    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    console.log(`[Admin] User deleted — ${user.email}`);

    return res.json({ success: true, message: `User "${user.name}" permanently deleted.` });
  } catch (err) {
    console.error("[Admin] DELETE /users/:id error:", err);
    return res.status(500).json({ success: false, message: "Server error deleting user." });
  }
});


// ─────────────────────────────────────────────────────────────
//  GET /api/admin/stats
//  Quick dashboard statistics
// ─────────────────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const [total, tokenAgg, newThisWeek] = await Promise.all([
      User.countDocuments(),
      User.aggregate([{ $group: { _id: null, total: { $sum: "$tokens" }, avg: { $avg: "$tokens" } } }]),
      User.countDocuments({ createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
    ]);

    return res.json({
      success: true,
      stats: {
        totalUsers: total,
        newThisWeek,
        totalTokensInCirculation: tokenAgg[0]?.total || 0,
        avgTokensPerUser: Math.round(tokenAgg[0]?.avg || 0),
      },
    });
  } catch (err) {
    console.error("[Admin] GET /stats error:", err);
    return res.status(500).json({ success: false, message: "Server error fetching stats." });
  }
});


module.exports = router;


// ─────────────────────────────────────────────────────────────
//  SETUP CHECKLIST
//
//  1. Copy this file to  routes/admin.js
//
//  2. In your  app.js / server.js  add:
//       const adminRoutes = require('./routes/admin');
//       app.use('/api/admin', adminRoutes);
//
//  3. In your  .env  file add:
//       ADMIN_SECRET=pick-a-long-random-secret-string
//
//  4. In SuperAdminPanel.jsx update the two constants at the top:
//       ADMIN_EMAIL    — your login email (frontend only)
//       ADMIN_PASSWORD — your login password (frontend only)
//       API_BASE       — e.g. https://api.yourdomain.com/api/admin
//
//     Then in adminApi helpers, the x-admin-key header should
//     match ADMIN_SECRET in your .env.
//     Simplest approach: hardcode it in the JSX for now,
//     or set it equal to btoa(email+password) and verify server-side.
//
//  5. CORS — make sure your frontend domain is allowed.
//       app.use(cors({ origin: ['https://yourdomain.com'] }));
//
//  API SUMMARY:
//    GET    /api/admin/users              — list all users
//    GET    /api/admin/users/:id          — single user detail
//    PATCH  /api/admin/users/:id/tokens   — add/deduct/set tokens
//    DELETE /api/admin/users/:id          — delete user
//    GET    /api/admin/stats              — dashboard stats
// ─────────────────────────────────────────────────────────────