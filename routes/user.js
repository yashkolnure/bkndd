// routes/user.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

router.post("/update-fcm-token", authMiddleware, async (req, res) => {
  const { fcmToken, userId } = req.body;
  const targetUserId = userId || req.user?.id || req.user?._id;

  if (!fcmToken || !targetUserId) {
    return res.status(400).send("User ID and Token are required");
  }

  try {
    const user = await User.findByIdAndUpdate(
      targetUserId,
      { $set: { fcmToken: fcmToken } }, // Use $set to overwrite with the latest
      { new: true }
    );

    if (!user) {
      return res.status(404).send("User not found");
    }

    console.log(`FCM: Updated latest token for ${user.email}`);
    res.sendStatus(200);
  } catch (error) {
    console.error("Error updating FCM token:", error);
    res.status(500).send("Server Error");
  }
});

module.exports = router;