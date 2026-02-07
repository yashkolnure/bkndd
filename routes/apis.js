const User = require("../models/User");
const express = require("express");
const router = express.Router();
const axios = require("axios");
const verifyApiKey = require('../middleware/apiAuth');


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


// Meta Webhook Verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === "myautobot_secret") {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Receiving the Actual Message
app.post('/webhook', (req, res) => {
  const body = req.body;
  if (body.object === 'whatsapp_business_account') {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (message) {
      // THIS PUSHES DATA TO YOUR REACT DASHBOARD INSTANTLY
      io.emit('whatsapp_message', {
        text: message.text.body,
        from: message.from,
        time: new Date().toLocaleTimeString()
      });
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// --- PUBLIC CHAT ENDPOINT ---
// --- PUBLIC CHAT ENDPOINT (OPTIMIZED) ---
router.post("/v1/chat/completions", async (req, res) => {
  const apiKey = req.headers["x-api-key"];
  const { messages, model, customerData } = req.body;
  const CHAT_COST = 5;

  if (!apiKey) return res.status(401).json({ error: "API Key Required" });

  try {
    // 1. ATOMIC VERIFY & DEDUCT 
    // This prevents "race conditions" where a user could spend more than they have
    const user = await User.findOneAndUpdate(
      { apiKey: apiKey, tokens: { $gte: CHAT_COST } },
      { $inc: { tokens: -CHAT_COST } },
      { new: true }
    );

    if (!user) {
      return res.status(402).json({ 
        success: false, 
        error: "Insufficient Tokens or Invalid API Key." 
      });
    }

    // 2. PREPARE SYSTEM PROMPT (Injection of RAG/Knowledge)
    // Ensures the external API call respects the Bot's instructions
    const systemMessage = {
      role: "system",
      content: `${user.botConfig.systemPrompt}\n\n[KNOWLEDGE_BASE]\n${user.botConfig.ragFile}`.trim()
    };

    const finalMessages = [systemMessage, ...messages];

    // 3. FORWARD TO VPS LLM (With Timeout Protection)
    try {
      const llmResponse = await axios.post(
        "http://51.79.175.189:11434/api/chat", 
        {
          model: model || user.botConfig.model.primary || "llama3",
          messages: finalMessages,
          stream: false,
          options: {
             num_thread: 16, // Optimized for your 24-core VPS
             num_ctx: 4096
          }
        },
        { timeout: 90000 } // 90 second limit
      );

      // 4. RETURN RESPONSE
      return res.json({
        success: true,
        ...llmResponse.data,
        myautobot_usage: {
          tokens_deducted: CHAT_COST,
          remaining_balance: user.tokens
        }
      });

    } catch (llmErr) {
      await User.findByIdAndUpdate(user._id, { $inc: { tokens: CHAT_COST } });
      
      console.error("🔥 VPS LLM Error:", llmErr.message);
      return res.status(502).json({ 
        success: false, 
        error: "Neural Engine Timeout. Tokens have been refunded." 
      });
    }

  } catch (err) {
    console.error("🔥 Global API Error:", err.stack);
    res.status(500).json({ success: false, error: "System Anomaly Detected." });
  }
});

router.get('/user-profile/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId).select('apiKey tokens name botConfig');
        if (!user) return res.status(404).json({ message: "User not found" });
        res.json(user);
    } catch (err) {
        res.status(500).json({ message: "Database error" });
    }
});

// --- 2. VERIFY API KEY ROUTE ---
// Matches: GET /api/v1/auth/verify
// NOTE: If this is inside your 'auth' router, the path in app.js must be adjusted.
router.get('/v1/auth/verify', verifyApiKey, (req, res) => {
    res.json({ 
        success: true, 
        message: "Connection Stable.", 
        node: req.user.name, 
        balance: req.user.tokens 
    });
});

// routes/auth.js (or user.js)

router.get("/user-profile/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select("tokens referralCode referralCount name email");

    if (!user) return res.status(404).json({ message: "Operator not found." });

    // --- FIX FOR EXISTING USERS ---
    if (!user.referralCode) {
      user.referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      await user.save(); // Save the new code permanently
    }

    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Neural sync error" });
  }
});

module.exports = router;
