const User = require("../models/User");
const express = require("express");
const router = express.Router();
const axios = require("axios");
const verifyApiKey = require('../middleware/apiAuth');
const multer = require('multer');
const mongoose = require("mongoose");

const FormData = require('form-data'); // Ensure this is the node 'form-data' package

const upload = multer({ storage: multer.memoryStorage() });
router.post('/chat', async (req, res) => {
    try {
        // 1. EXTRACT HISTORY FROM REQUEST BODY
        const { message, userId, history } = req.body; 

        if (!userId || !message) {
            return res.status(400).json({ error: "Missing Neural context (userId or message)" });
        }

        const user = await User.findById(userId);
        if (!user || !user.botIds) {
            return res.status(404).json({ error: "No active Agent found for this Operator." });
        }

        const ids = user.botIds.split(',').filter(id => id.trim());
        const activeBotId = ids[ids.length - 1]; 

        // 2. CONSTRUCT THE CHAT PAYLOAD WITH MEMORY
        // If history exists, we map it. If not, we start a new array.
        let formattedMessages = [];

        if (history && Array.isArray(history)) {
            formattedMessages = history.map(msg => ({
                // Open WebUI expects 'assistant', but your React state uses 'bot'
                role: msg.role === 'bot' ? 'assistant' : msg.role,
                content: msg.content
            }));
        } else {
            // Fallback if history is missing
            formattedMessages = [{ role: "user", content: message }];
        }

        const chatPayload = {
            model: activeBotId,
            messages: formattedMessages, // <--- NOW CONTAINS THE FULL TRANSCRIPT
        };

        const targetUrl = `${process.env.CLOUDFLARE_URL}/chat/completions`;
        const headers = { 
            'Authorization': `Bearer ${process.env.BOT_API_KEY.trim()}`,
            'Content-Type': 'application/json'
        };

        const response = await axios.post(targetUrl, chatPayload, { headers });

        res.json({
            success: true,
            reply: response.data.choices[0].message.content,
            botId: activeBotId
        });

    } catch (err) {
        console.error("💥 Chat Sync Error:", err.response?.data || err.message);
        res.status(err.response?.status || 500).json({ 
            error: "Neural pathway blocked.", 
            details: err.response?.data || err.message 
        });
    }
});

router.get('/user-inventory/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user || !user.botIds) return res.json({ bots: [] });

        const ids = user.botIds.split(',').filter(id => id.trim());
        
        // Optional: Fetch current names from OpenWebUI so they are always synced
        const botList = await Promise.all(ids.map(async (id) => {
            try {
                const owuRes = await axios.get(`${process.env.CLOUDFLARE_URL}/models/model?id=${id}`, { headers });
                return { id: id, name: owuRes.data.name };
            } catch {
                return { id: id, name: "Unknown Bot" };
            }
        }));

        res.json({ bots: botList });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * 2. GET BOT CONFIG (FROM OPENWEBUI)
 * We fetch the model from OpenWebUI and extract the system prompt
 */
const OPENWEBUI_URL = process.env.CLOUDFLARE_URL;
const OPENWEBUI_KEY = process.env.BOT_API_KEY;

router.get('/config/:botId', async (req, res) => {
    try {
        const headers = { 'Authorization': `Bearer ${process.env.BOT_API_KEY.trim()}` };
        const response = await axios.get(`${process.env.CLOUDFLARE_URL}/models/model?id=${req.params.botId}`, { headers });
        
        const owuModel = response.data;

        // Ensure we send the WHOLE meta object so the frontend can see 'knowledge'
        res.json({ 
            botConfig: {
                id: owuModel.id,
                name: owuModel.name,
                customSystemPrompt: owuModel.params?.system || "",
                meta: owuModel.meta, // <--- THIS MUST BE INCLUDED
                model: { primary: owuModel.base_model_id }
            } 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
/**
 * 2. UPDATE BOT CONFIGURATION
 */
router.put('/update', async (req, res) => {
    try {
        // 1. EXTRACT ALL DATA FROM FRONTEND
        // We need botName, baseModel, and knowledgeFiles to actually apply changes
        const { botId, systemPrompt, botName, baseModel, knowledgeFiles } = req.body;
        
        const OPENWEBUI_URL = process.env.CLOUDFLARE_URL;
        const OPENWEBUI_KEY = process.env.BOT_API_KEY;
        const headers = { 
            'Authorization': `Bearer ${OPENWEBUI_KEY?.trim()}`,
            'Content-Type': 'application/json'
        };

        if (!botId) return res.status(400).json({ error: "Missing botId" });

        // --- STEP 1: FETCH CURRENT MODEL STATE ---
        // We still fetch to ensure we don't lose other meta tags (like images/caps)
        const currentRes = await axios.get(`${OPENWEBUI_URL}/models/model?id=${botId}`, { headers });
        const currentModel = currentRes.data;

        // --- STEP 2: CONSTRUCT THE ACTUAL UPDATED PAYLOAD ---
        const updatePayload = {
            id: botId,
            // Use new name if provided, otherwise stay with current
            name: botName || currentModel.name, 
            // Use new base model if provided, otherwise stay with current
            base_model_id: baseModel || currentModel.base_model_id, 
            params: { 
                ...currentModel.params, 
                system: systemPrompt // Update the logic
            },
            meta: {
                ...currentModel.meta, 
                // CRITICAL: Use the knowledgeFiles array from the frontend.
                // If a user deleted a file in the UI, it won't be in this array.
                knowledge: knowledgeFiles || currentModel.meta?.knowledge 
            }
        };

        // --- STEP 3: SYNC TO OPENWEBUI ---
        const targetUrl = `${OPENWEBUI_URL}/models/model/update?id=${botId}`;
        console.log(`📤 Syncing Neural Architecture for: ${updatePayload.name}`);
        
        const response = await axios.post(targetUrl, updatePayload, { headers });

        res.json({ 
            success: true, 
            message: "Neural Node Synced",
            data: response.data 
        });
        console.log("✅ Sync successful for bot:", updatePayload.name);

    } catch (err) {
        const errorData = err.response?.data || err.message;
        console.error("💥 Sync Error:", errorData);
        res.status(err.response?.status || 500).json({ error: "Sync failed", details: errorData });
    }
});

router.post('/upload-knowledge', upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        const headers = { 'Authorization': `Bearer ${process.env.BOT_API_KEY.trim()}` };

        // 1. Upload to OpenWebUI files endpoint
        const form = new FormData();
        form.append('file', file.buffer, { filename: file.originalname });
        
        const uploadRes = await axios.post(`${process.env.CLOUDFLARE_URL}/files/`, form, {
            headers: { ...headers, ...form.getHeaders() }
        });

        // 2. Return the metadata so the frontend can add it to the list
        res.json({ 
            success: true, 
            fileMetadata: {
                type: "file",
                id: uploadRes.data.id,
                name: file.originalname
            } 
        });
    } catch (err) {
        res.status(500).json({ error: "Upload failed" });
    }
});

router.post('/deploy-bot', upload.array('files'), async (req, res) => {
    try {
        // userId must be sent from the frontend to identify the record to update
        const { botName, systemPrompt, userId } = req.body; 
        const files = req.files;

        if (!files || files.length === 0) {
            return res.status(400).json({ error: "No files received by server" });
        }

        const headers = { 'Authorization': `Bearer ${process.env.BOT_API_KEY}` };
        const knowledgeItems = [];

        console.log(`🚀 Processing ${files.length} documents for: ${botName}`);

        // --- PHASE 1 & 2: UPLOAD & POLL ---
        for (const file of files) {
            console.log(`📡 Phase 1: Uploading ${file.originalname}...`);
            const form = new FormData();
            form.append('file', file.buffer, { filename: file.originalname });
            form.append('process', 'true');

            const uploadRes = await axios.post(`${process.env.CLOUDFLARE_URL}/files/`, form, {
                headers: { ...headers, ...form.getHeaders() }
            });

            const fileId = uploadRes.data.id;

            let isReady = false;
            for (let i = 0; i < 20; i++) {
                const statusRes = await axios.get(`${process.env.CLOUDFLARE_URL}/files/${fileId}/process/status`, { headers });
                if (statusRes.data.status === 'completed') {
                    isReady = true;
                    break;
                }
                if (statusRes.data.status === 'failed') throw new Error(`Vector processing failed for ${file.originalname}`);
                await new Promise(r => setTimeout(r, 2000));
            }

            if (!isReady) throw new Error(`Indexing timed out for ${file.originalname}`);

            knowledgeItems.push({
                "type": "file",
                "id": fileId,
                "url": fileId,
                "name": file.originalname,
                "status": "uploaded",
                "size": file.size,
                "file": uploadRes.data
            });
            console.log(`✅ ${file.originalname} processed.`);
        }

        // --- PHASE 3: CREATE AGENT ---
        console.log("🤖 Phase 3: Creating multi-document agent...");
        const botPayload = {
            "id": `bot_${Date.now()}`,
            "base_model_id": "llama3.1:8b",
            "name": botName,
            "meta": {
                "profile_image_url": "/static/favicon.png",
                "capabilities": { 
                    "file_context": true, "vision": true, "file_upload": true, 
                    "web_search": true, "image_generation": true, "citations": true
                },
                "system": systemPrompt,
                "knowledge": knowledgeItems,
                "params": { 
                    "system": systemPrompt, "temperature": 0.3, "stop": ["User:", "Assistant:"]
                }
            },
            "params": { "system": systemPrompt },
            "is_active": true
        };

        const botRes = await axios.post(`${process.env.CLOUDFLARE_URL}/models/create`, botPayload, { headers });
        const finalBotId = botRes.data.id; // Get the real ID from the API response

        // --- PHASE 4: DATABASE PERSISTENCE ---
        if (userId) {
            console.log(`💾 Syncing bot [${finalBotId}] to User [${userId}]...`);
            
            /** * Mongoose approach: Appending to a string or array 
             * If your user table has 'botIds' and 'botNames' as strings:
             */
             const user = await User.findById(userId);
             if (user) {
                 // Option A: If storing as comma-separated strings
                 user.botIds = user.botIds ? `${user.botIds},${finalBotId}` : finalBotId;
                 user.botNames = user.botNames ? `${user.botNames},${botName}` : botName;
                 
                 await user.save();
                 console.log("✅ User table updated successfully.");
             }
        }

        console.log("🎉 Pipeline complete. Agent live and stored.");
        res.status(200).json({ success: true, botId: finalBotId });

    } catch (error) {
        console.error("Pipeline Error:", error.response?.data || error.message);
        res.status(500).json({ 
            error: error.message,
            details: error.response?.data || "Internal server error" 
        });
    }
});


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
