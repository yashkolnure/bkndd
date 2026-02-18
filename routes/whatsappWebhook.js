const express = require("express");
const router = express.Router();
const User = require('../models/User'); 
const Conversation = require('../models/Conversation');
const axios = require('axios');
const FormData = require('form-data');


router.post("/whatsapp", async (req, res) => {
  const body = req.body;
  
  if (body.object === "whatsapp_business_account") {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0]?.value;
    
    // Use the Phone Number ID from metadata instead of the entry ID
    const phoneNumberId = changes?.metadata?.phone_number_id;
    const message = changes?.messages?.[0];

    if (message && phoneNumberId) {
      const customerNumber = message.from;
      const userQuery = message.text?.body;

      try {
        // 1. Find the User using the Phone Number ID
        // Note: Ensure your User model 'whatsappBusinessId' field contains the Phone Number ID
        const owner = await User.findOne({ 
          $or: [
            { "botConfig.phoneNumberId": phoneNumberId },
            { whatsappBusinessId: phoneNumberId } 
          ]
        });

        if (!owner) {
          console.log(`Owner not found for Phone ID: ${phoneNumberId}`);
          return res.sendStatus(200);
        }

        // 2. Log incoming message to DB
        await Conversation.findOneAndUpdate(
          { user: owner._id, customerIdentifier: customerNumber },
          {
            $push: { messages: { role: 'user', text: userQuery, source: 'whatsapp', timestamp: new Date() } },
            $set: { lastInteraction: new Date() }
          },
          { upsert: true }
        );

        // 3. CHECK TOGGLE
        if (owner.botConfig?.isManualPromptEnabled) {
          const fd = new FormData();
          const bizId = owner.activeKnowledgeBase + '_' + owner._id;
          fd.append('biz_id', bizId);
          fd.append('user_query', userQuery);

          // 4. Get Reply from AI Brain
          const aiRes = await axios.post('http://72.60.196.84:8000/chat', fd, {
            headers: fd.getHeaders()
          });

          const aiReply = aiRes.data.response;

          // 5. Send AI Reply back
          await axios.post(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
            messaging_product: "whatsapp",
            to: customerNumber,
            type: "text",
            text: { body: aiReply }
          }, {
            headers: { 'Authorization': `Bearer ${owner.whatsappToken}` }
          });

          // 6. Log AI reply
          await Conversation.findOneAndUpdate(
            { user: owner._id, customerIdentifier: customerNumber },
            {
              $push: { messages: { role: 'bot', text: aiReply, source: 'whatsapp', timestamp: new Date() } },
              $set: { lastInteraction: new Date() }
            }
          );
        }
      } catch (err) {
        console.error("Webhook Processing Error:", err.response?.data || err.message);
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