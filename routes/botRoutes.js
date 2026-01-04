const express = require('express');
const router = express.Router();
const Bot = require('../models/Bot');
// FIX THIS LINE: Match the filename exactly (auth.js)
const authMiddleware = require('../middleware/auth');

router.post('/v2/update-config', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const payload = req.body;

    const updatedBot = await Bot.findOneAndUpdate(
      { user: userId },
      { ...payload, user: userId, updatedAt: Date.now() },
      { new: true, upsert: true }
    );

    res.status(200).json({
      success: true,
      bot: updatedBot
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
module.exports = router;