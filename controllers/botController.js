const Bot = require('../models/Bot');

// SAVE OR UPDATE BOT CONFIG
exports.saveBotConfig = async (req, res) => {
  try {
    const userId = req.user.id; // Derived from your Auth Middleware
    const updateData = req.body;

    // 1. Validation check (Backend Safety)
    if (!updateData.businessName) {
      return res.status(400).json({ 
        success: false, 
        message: "Business name is required" 
      });
    }

    // 2. Find by userId and Update, or Create if not found
    const bot = await Bot.findOneAndUpdate(
      { userId: userId },
      { $set: updateData },
      { 
        new: true,          // Return the updated document
        runValidators: true, // Ensure schema rules are followed
        upsert: true         // Create if it doesn't exist
      }
    );

    res.status(200).json({
      success: true,
      message: "Bot configuration saved successfully",
      bot
    });

  } catch (error) {
    console.error("BOT_SAVE_ERROR:", error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// GET BOT CONFIG
exports.getBotConfig = async (req, res) => {
  try {
    const userId = req.user.id;
    const bot = await Bot.findOne({ userId: userId });

    if (!bot) {
      return res.status(404).json({ 
        success: false, 
        message: "No bot configuration found for this user." 
      });
    }

    res.status(200).json({
      success: true,
      bot
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};