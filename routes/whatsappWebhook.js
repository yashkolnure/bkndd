const express = require("express");
const router = express.Router();
const User = require('../models/User'); 
const Conversation = require('../models/Conversation');
const axios = require('axios');
const FormData = require('form-data');


router.post("/whatsapp", async (req, res) => {
  const body = req.body;
  console.log("Received WhatsApp Webhook:", JSON.stringify(body, null, 2)); // Log the entire payload for debugging

  if (body.object === "whatsapp_business_account") {
    const entry = body.entry?.[0];
    const wabaId = entry?.id;
    const message = entry?.changes?.[0]?.value?.messages?.[0];

    if (message && wabaId) {
      const customerNumber = message.from;
      const userQuery = message.text?.body;

      try {
        // 1. Find the User who owns this Business Account
        const owner = await User.findOne({ whatsappBusinessId: wabaId });
        if (!owner) return res.sendStatus(200);

        // 2. Log incoming message to DB
        await Conversation.findOneAndUpdate(
          { user: owner._id, customerIdentifier: customerNumber },
          {
            $push: { messages: { role: 'user', text: userQuery, source: 'whatsapp', timestamp: new Date() } },
            $set: { lastInteraction: new Date() }
          },
          { upsert: true }
        );

        // 3. CHECK TOGGLE: Only proceed to AI if Auto-Reply is ON
        if (owner.botConfig?.isManualPromptEnabled) {
          
          // Prepare data for your AI Brain (using FormData as per your test page)
          const fd = new FormData();
          // Use owner name as biz_id (ensure this matches what's in your AI brain)
          const bizId = owner.activeKnowledgeBase + '_' + owner._id; // Fallback biz_id
          fd.append('biz_id', bizId);
          fd.append('user_query', userQuery);
          console.log("Prepared FormData for AI:", { bizId, userQuery });


          // 4. Get Reply from AI Brain
          const aiRes = await axios.post('http://72.60.196.84:8000/chat', fd, {
            headers: fd.getHeaders()
          });

          const aiReply = aiRes.data.response;

          // 5. Send AI Reply back to WhatsApp via Meta API
          await axios.post(`https://graph.facebook.com/v21.0/${owner.botConfig.phoneNumberId || '959176433945485'}/messages`, {
            messaging_product: "whatsapp",
            to: customerNumber,
            type: "text",
            text: { body: aiReply }
          }, {
            headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN || owner.whatsappToken}` }
          });

          // 6. Log the AI's reply to DB history
          await Conversation.findOneAndUpdate(
            { user: owner._id, customerIdentifier: customerNumber },
            {
              $push: { messages: { role: 'bot', text: aiReply, source: 'whatsapp', timestamp: new Date() } },
              $set: { lastInteraction: new Date() }
            }
          );
        }
      } catch (err) {
        console.error("AI Auto-Reply Error:", err.message);
      }
    }
    return res.sendStatus(200);
  }
  res.sendStatus(404);
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