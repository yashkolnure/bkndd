// routes/integrations.js
const express = require("express");
const router = express.Router();
const User = require("../models/User");

// --- 1. GLOBAL FETCH: Syncs all configurations for the UI ---
router.get("/all/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select(
      "instagramBusinessId instagramToken whatsappBusinessId whatsappToken tgBotToken instagramEnabled whatsappEnabled"
    );

    if (!user) return res.status(404).json({ message: "User not found" });

    // Mapping DB fields to the Frontend expectations
    res.json({
      instaId: user.instagramBusinessId,
      instaAccessToken: user.instagramToken,
      waPhoneId: user.whatsappBusinessId,
      waAccessToken: user.whatsappToken,
      tgBotToken: user.tgBotToken // Ensure this field exists in your schema if adding Telegram
    });
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

// --- 2. INSTAGRAM LINK ---
router.post("/manual/instagram", async (req, res) => {
  try {
    const { userId, instaId, accessToken } = req.body;
    
    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          instagramBusinessId: instaId,
          instagramToken: accessToken,
          instagramEnabled: true
        }
      },
      { new: true }
    );

    res.json({ success: true, message: "Instagram Linked" });
  } catch (err) {
    res.status(500).json({ message: "Integration Sync Error" });
  }
});

// --- 3. WHATSAPP LINK ---
router.post("/manual/whatsapp", async (req, res) => {
  try {
    const { userId, phoneId, accessToken } = req.body;
    
    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          whatsappBusinessId: phoneId,
          whatsappToken: accessToken,
          whatsappEnabled: true
        }
      },
      { new: true }
    );

    res.json({ success: true, message: "WhatsApp Linked" });
  } catch (err) {
    res.status(500).json({ message: "WhatsApp Sync Error" });
  }
});

// --- 4. TELEGRAM LINK ---
// NOTE: Since tgBotToken wasn't in your original schema snippet, 
// make sure to add { tgBotToken: String } to your User model.
router.post("/manual/telegram", async (req, res) => {
  try {
    const { userId, botToken } = req.body;
    
    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          tgBotToken: botToken,
          // If you add a tgEnabled field: telegramEnabled: true
        }
      },
      { new: true }
    );

    res.json({ success: true, message: "Telegram Linked" });
  } catch (err) {
    res.status(500).json({ message: "Telegram Sync Error" });
  }
});

module.exports = router;