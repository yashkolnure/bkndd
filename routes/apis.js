const User = require("../models/User");
const express = require("express");
const router = express.Router();
const axios = require("axios");


router.get("/integrations/manual/instagram/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select(
      "instagramBusinessId instagramToken"
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({
      instaId: user.instagramBusinessId || "",
      accessToken: user.instagramToken || ""
    });
  } catch (err) {
    console.error("Fetch IG config error:", err);
    res.status(500).json({ message: "Failed to fetch Instagram config" });
  }
});

// POST /integrations/manual/instagram
router.post("/integrations/manual/instagram", async (req, res) => {
  try {
    const { userId, instaId, accessToken, verifyToken } = req.body;

    if (!userId || !instaId || !accessToken) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      {
        instagramEnabled: true,
        instagramBusinessId: instaId,
        instagramToken: accessToken
        // verifyToken is ONLY for webhook verification, not needed in DB
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({
      success: true,
      user: {
        id: user._id,
        instagramEnabled: user.instagramEnabled,
        instagramBusinessId: user.instagramBusinessId
      }
    });
  } catch (err) {
    console.error("Instagram save error:", err);
    return res.status(500).json({ message: "Failed to save Instagram config" });
  }
});


// --- PUBLIC CHAT ENDPOINT ---
router.post("/v1/chat/completions", async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  const { messages, model } = req.body;

  if (!apiKey) return res.status(401).json({ error: "API Key Required" });

  try {
    // 1. Verify User and API Key
    const user = await User.findOne({ apiKey });
    if (!user) return res.status(401).json({ error: "Invalid API Key" });

    // 2. Check Token Balance (Cost: 5 tokens per call)
    const COST = 5;
    if (user.tokens < COST) {
      return res.status(402).json({ error: "Insufficient Tokens. Balance: " + user.tokens });
    }

    // 3. Forward to your VPS-hosted LLM (Ollama Example)
    // Adjust URL if your LLM is on a different port/IP
    const llmResponse = await axios.post("http://51.79.175.189:11434/api/chat", {
      model: model || user.botConfig.model.primary || "llama3",
      messages: messages,
      stream: false
    });

    // 4. Deduct Tokens & Save
    user.tokens -= COST;
    await user.save();

    // 5. Return LLM Response + Usage Info
    res.json({
      ...llmResponse.data,
      myautobot_usage: {
        tokens_deducted: COST,
        remaining_balance: user.tokens
      }
    });

  } catch (err) {
    console.error("🔥 API Error:", err.message);
    res.status(500).json({ error: "AI Engine Offline or Internal Error" });
  }
});


module.exports = router;
