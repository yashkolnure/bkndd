const express = require("express");
const router = express.Router();
const User = require('../models/User'); 
const Conversation = require('../models/Conversation');
const axios = require('axios');
const FormData = require('form-data');
const { Mutex } = require('async-mutex');

// Memory cache for mutexes to handle concurrent messages from the same user
const userLocks = new Map();

/**
 * PRODUCTION-READY WHATSAPP WEBHOOK
 * Features: Race-condition handling, strict prompt grounding, history management
 */
router.post("/whatsapp", async (req, res) => {
  const body = req.body;

  // 1. Quick Validation & Ack
  if (body.object !== "whatsapp_business_account") return res.sendStatus(404);
  
  const entry = body.entry?.[0];
  const changes = entry?.changes?.[0]?.value;
  const phoneNumberId = changes?.metadata?.phone_number_id;
  const message = changes?.messages?.[0];

  // Return 200 immediately to Meta to avoid retries/timeouts
  res.sendStatus(200);

  // 2. Filter for text messages only (Expand this for media later)
  if (!message || !message.text || !phoneNumberId) return;

  const customerNumber = message.from;
  const userQuery = message.text.body.trim();

  // 3. Prevent Race Conditions using a Mutex Lock per Customer
  // This ensures if a user sends 3 messages rapidly, they are processed in order.
  if (!userLocks.has(customerNumber)) userLocks.set(customerNumber, new Mutex());
  const release = await userLocks.get(customerNumber).acquire();

  try {
    // 4. Optimized User Lookup
    const owner = await User.findOne({ 
      $or: [{ "botConfig.phoneNumberId": phoneNumberId }, { whatsappBusinessId: phoneNumberId }] 
    }).lean(); // .lean() for faster read-only access

    if (!owner || !owner.botConfig?.isManualPromptEnabled) return;

    // 5. Atomic Update of Conversation History
    const conversation = await Conversation.findOneAndUpdate(
      { user: owner._id, customerIdentifier: customerNumber },
      {
        $push: { 
          messages: { 
            $each: [{ role: 'user', text: userQuery, source: 'whatsapp', timestamp: new Date() }],
            $slice: -20 // Keep last 20 messages in DB to prevent document bloat
          } 
        },
        $set: { lastInteraction: new Date() }
      },
      { upsert: true, new: true }
    );

    // 6. Build Contextual Prompt (The "Brain" Logic)
    const historyContext = conversation.messages.slice(-6)
      .map(m => `${m.role === 'user' ? 'Customer' : 'Assistant'}: ${m.text}`)
      .join('\n');

    const systemInstruction = `
      ROLE: Official AI Support for myAutoBot.in.
      STRICT RULES:
      1. Use ONLY the provided Knowledge Base to answer. 
      2. If info is missing, say: "I'm sorry, I don't have that specific detail. Can I have your email so our team can contact you?"
      3. NEVER mention other AI models (OpenAI, Llama, etc).
      4. Tone: Professional, helpful, under 3 sentences.
      5. Today's Date: ${new Date().toDateString()}.
    `;

    // 7. Call AI Brain
    const fd = new FormData();
    fd.append('biz_id', `${owner.activeKnowledgeBase}_${owner._id}`);
    fd.append('user_query', `
      ${systemInstruction}
      
      HISTORY:
      ${historyContext}
      
      CURRENT QUESTION:
      ${userQuery}
    `);

    const aiRes = await axios.post('http://72.60.196.84:8000/chat', fd, {
      headers: fd.getHeaders(),
      timeout: 55000 // 55s timeout to prevent hanging requests
    });

    const aiReply = aiRes.data.response || "I'm having trouble connecting to my brain. Please try again in a moment.";

    // 8. Dispatch Message to Meta API
    await axios.post(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to: customerNumber,
      type: "text",
      text: { body: aiReply }
    }, {
      headers: { 'Authorization': `Bearer ${owner.whatsappToken}` }
    });

    // 9. Log the AI's reply
    await Conversation.updateOne(
      { user: owner._id, customerIdentifier: customerNumber },
      { $push: { messages: { role: 'bot', text: aiReply, source: 'whatsapp', timestamp: new Date() } } }
    );

  } catch (err) {
    console.error(`[CRITICAL ERROR] Customer: ${customerNumber} |`, err.response?.data || err.message);
  } finally {
    release(); // Always release the lock
  }
});

// This MUST be inside this same file or mounted on the same path
router.post("/log-outgoing", async (req, res) => {
  const { userId, customerNumber, text } = req.body;
  try {
    await Conversation.findOneAndUpdate(
      { user: userId, customerIdentifier: customerNumber },
      {
        $push: {
          messages: {
            role: 'bot',
            text: text,
            source: 'whatsapp',
            timestamp: new Date()
          }
        },
        $set: { lastInteraction: new Date() }
      },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// --- 2. THE GET ROUTE (Fetches from DB for Frontend) ---
router.get("/messages", async (req, res) => {
  try {
    const { userId } = req.query; // Passed from React
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    // Find conversations for this specific user
    const history = await Conversation.find({ 
        user: userId 
    }).sort({ lastInteraction: -1 });

    // On the frontend, you already have the filter for source === 'whatsapp'
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/toggle-auto-reply", async (req, res) => {
  const { userId, enabled } = req.body;

  try {
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { "botConfig.isManualPromptEnabled": enabled } }, // Using this field as the auto-reply toggle
      { new: true }
    );

    res.json({ success: true, isAutoReplyEnabled: user.botConfig.isManualPromptEnabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;