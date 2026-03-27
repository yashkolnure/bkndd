// routes/user.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

router.post("/update-fcm-token", authMiddleware, async (req, res) => {
  // 1. Get fcmToken AND userId from req.body (Android app sends both)
  const { fcmToken, userId } = req.body;

  // 2. Use the userId from the body, or fallback to the one in the token
  // Check if req.user has .id or ._id
  const targetUserId = userId || req.user.id || req.user._id;

  console.log("Incoming update for User ID:", targetUserId);
  console.log("Incoming FCM Token:", fcmToken);

  if (!fcmToken || !targetUserId) {
    return res.status(400).send("User ID and Token are required");
  }

  try {
    // 3. Update the user
    const user = await User.findByIdAndUpdate(
      targetUserId,
      { $addToSet: { fcmTokens: fcmToken } },
      { new: true } // This returns the updated document instead of the old one
    );

    if (!user) {
      console.error("User not found in database for ID:", targetUserId);
      return res.status(404).send("User not found");
    }

    console.log("Successfully updated FCM Tokens for:", user.email);
    res.sendStatus(200);
  } catch (error) {
    console.error("Error updating FCM token:", error);
    res.status(500).send("Server Error");
  }
});

module.exports = router;