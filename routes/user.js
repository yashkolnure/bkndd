// routes/user.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

router.post("/update-fcm-token", authMiddleware, async (req, res) => {
  const { fcmToken } = req.body;
  const userId = req.user._id;

  if (!fcmToken) return res.status(400).send("Token required");

  await User.findByIdAndUpdate(userId, {
    $addToSet: { fcmTokens: fcmToken } // $addToSet prevents duplicates
  });
  const user = await User.findById(userId);
  console.log("Updated FCM Tokens for User:", user);

  res.sendStatus(200);
});

module.exports = router;