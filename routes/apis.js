const User = require("../models/User");
const express = require("express");
const router = express.Router();
const axios = require("axios");
const verifyApiKey = require('../middleware/apiAuth');
const mongoose = require("mongoose");


router.put('/update/:id', async (req, res) => {
  try {
    const { name, email, contact, activeKnowledgeBase } = req.body;

    // Find user and update only the provided fields
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { 
        $set: { 
          name, 
          email, 
          contact, 
          activeKnowledgeBase 
        } 
      },
      { new: true, runValidators: true }
    ).select("-password"); // Don't return the hashed password

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({ success: true, data: updatedUser });
  } catch (error) {
    console.error("Backend Sync Error:", error);
    res.status(500).json({ success: false, message: "Server Error during update" });
  }
});

router.post('/kb/create/:userId', async (req, res) => {
  try {
    const { kbName, kbType } = req.body;
    const user = await User.findById(req.params.userId);

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Prevent duplicate names
    const exists = user.knowledgeBases.find(k => k.name === kbName);
    if (exists) return res.status(400).json({ success: false, message: "KB Name already exists" });

    user.knowledgeBases.push({ name: kbName, type: kbType || 'General' });
    await user.save();

    res.json({ success: true, data: user.knowledgeBases });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server Error" });
  }
});

// @route   GET /api/kb/list/:userId
// @desc    Fetch only the Knowledge Bases for the logged-in user
router.get('/kb/list/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    // Find the user by ID and only return the knowledgeBases array
    const user = await User.findById(userId).select('knowledgeBases activeKnowledgeBase');

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: "User context not found." 
      });
    }

    res.json({
      success: true,
      knowledgeBases: user.knowledgeBases || [],
      activeKnowledgeBase: user.activeKnowledgeBase || ""
    });
  } catch (error) {
    console.error("Internal Neural Error:", error);
    res.status(500).json({ success: false, message: "Server Handshake Failed." });
  }
});

// @route   PUT /api/update/:id
router.put('/update/:id', async (req, res) => {
  try {
    // Dynamically update any field sent: name, email, OR the whole knowledgeBases array
    const updateData = req.body;

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updateData }, 
      { new: true, runValidators: true }
    ).select("-password");

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Always return the fresh data so the frontend can stay in sync
    res.json({ success: true, data: updatedUser });
  } catch (error) {
    console.error("Update Error:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
});


router.get("/all/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/all/:userId", async (req, res) => {
  try {
    // 1. Validate ID format to prevent server hang
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
      return res.status(400).json({ message: "Invalid Operator ID format." });
    }

    // 2. Fetch data required by the UI
    // We include createdAt to calculate "Member Since"
    const user = await User.findById(req.params.userId)
      .select("name email tokens referralCode referralCount createdAt botConfig apiKey");

    if (!user) return res.status(404).json({ message: "Operator not found in neural net." });

    // 3. Fix for legacy users: Generate referral code if missing
    if (!user.referralCode) {
      user.referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      await user.save();
    }

    res.json({
      success: true,
      data: user
    });
  } catch (err) {
    console.error("Profile Sync Error:", err);
    res.status(500).json({ message: "Neural sync error" });
  }
});


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
        // Removing .select() returns all fields defined in the schema
        const user = await User.findById(req.params.userId); 
        
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

// @route   PUT /api/update/:id
router.put('/update/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const { deleteKBId, name, email, contact, activeKnowledgeBase } = req.body;

    let updateQuery = {};

    // --- LOGIC 1: DELETE KB ENTRY ---
    if (deleteKBId) {
      updateQuery = { 
        $pull: { knowledgeBases: { _id: deleteKBId } } 
      };
      
      // Optional: If the KB being deleted is the active one, clear the active flag
      const userBeforeDelete = await User.findById(userId);
      const kbToDelete = userBeforeDelete.knowledgeBases.id(deleteKBId);
      
      if (userBeforeDelete.activeKnowledgeBase === kbToDelete?.name) {
        updateQuery.$set = { activeKnowledgeBase: "" };
      }
    } 
    // --- LOGIC 2: UPDATE PROFILE DATA ---
    else {
      updateQuery = { 
        $set: { 
          ...(name && { name }), 
          ...(email && { email }), 
          ...(contact && { contact }),
          ...(activeKnowledgeBase !== undefined && { activeKnowledgeBase })
        } 
      };
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateQuery,
      { new: true, runValidators: true }
    ).select("-password");

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    res.json({ success: true, data: updatedUser });

  } catch (error) {
    console.error("Registry Sync Error:", error);
    res.status(500).json({ success: false, message: "Server Error during sync." });
  }
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
