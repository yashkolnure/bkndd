const express = require("express");
const router = express.Router();
const User = require('../models/User'); 
const Conversation = require('../models/Conversation');
const axios = require('axios');
const FormData = require('form-data');
const { Mutex } = require('async-mutex');
const ProcessedMessage = require("../models/ProcessedMessage");

// Memory cache for mutexes to handle concurrent messages from the same user
const userLocks = new Map();

/**
 * PRODUCTION-READY WHATSAPP WEBHOOK
 * Features: Race-condition handling, strict prompt grounding, history management
 */


router.post("/whatsapp", async (req, res) => {
  const body = req.body;
  if (body.object !== "whatsapp_business_account") return res.sendStatus(404);
  console.log("Received WhatsApp Webhook:", JSON.stringify(body));
  
  // Ack to Meta immediately to prevent retries
  res.sendStatus(200); 

  const entry = body.entry?.[0];
  const changes = entry?.changes?.[0]?.value;
  
  // Ignore status updates (delivered, read, etc.)
  if (changes?.statuses) return; 

  const phoneNumberId = changes?.metadata?.phone_number_id;
  const message = changes?.messages?.[0];

  if (!message || !message.text || !phoneNumberId) return;

  const customerNumber = message.from;
  const userQuery = message.text.body.trim();
  const messageId = message.id; // Extract unique message ID from Meta

  try {

  await ProcessedMessage.create({
    messageId: messageId,
    customerNumber: customerNumber
  });

} catch (err) {

  if (err.code === 11000) {
    console.log("Duplicate webhook ignored:", messageId);
    return;
  }

  throw err;
}
  // Mutex lock to prevent race conditions
  if (!userLocks.has(customerNumber)) userLocks.set(customerNumber, new Mutex());
  const release = await userLocks.get(customerNumber).acquire();

  console.log(`Processing message from ${customerNumber}: "${userQuery}" (ID: ${messageId})`);

  try {
    // 1. DEDUPLICATION CHECK
    const existingMessage = await Conversation.findOne({
      customerIdentifier: customerNumber,
      "messages.messageId": messageId 
    }).lean();
    
    if (existingMessage) {
      console.log("Duplicate message ignored:", messageId);
      return; 
    }
   
    // 2. SAFE OWNER LOOKUP
    const owner = await User.findOne({ 
      $or: [
        { "botConfig.phoneNumberId": phoneNumberId }, 
        { "botConfig.phoneNumberId": Number(phoneNumberId) },
        { whatsappBusinessId: phoneNumberId }
      ] 
    }).lean();
    
    if (!owner || !owner._id) {
      console.error(`[CRITICAL] Owner not found or missing _id for Phone ID: ${phoneNumberId}`);
      return;
    }

    // 3. UPDATE DB & GET HISTORY (Moved UP to always log incoming text)
    const conversation = await Conversation.findOneAndUpdate(
      { user: owner._id, customerIdentifier: customerNumber },
      {
        $push: { 
          messages: { 
            $each: [{ role: 'user', text: userQuery, source: 'whatsapp', timestamp: new Date(), messageId: messageId }],
            $slice: -15 
          } 
        },
        $set: { lastInteraction: new Date() },
        $setOnInsert: {
          user: owner._id,
          customerIdentifier: customerNumber,
          createdAt: new Date(),
          status: 'active' 
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );

    console.log("Updated conversation history. Total messages stored:", conversation.messages.length);

    // 4. CHECK IF AI IS ENABLED (Moved DOWN)
    // If auto-reply is off, we stop here. The user's message is already saved!
    if (!owner.botConfig?.isManualPromptEnabled) {
      console.log(`Manual mode active for Owner ID: ${owner._id}. Message logged, skipping AI reply.`);
      return;
    }

    // --- EVERYTHING BELOW ONLY RUNS IF AI IS ON ---
    console.log("Identified owner for phoneNumberId", phoneNumberId, "Owner ID:", owner._id);
    const ids = owner.botIds.split(',').filter(id => id.trim());
    const activeBotId = ids[ids.length - 1]; 

    const historyForAI = conversation.messages.map(m => ({
      role: m.role === 'bot' ? 'assistant' : 'user',
      content: m.text
    }));

    const systemInstruction = {
      role: "system",
      content: `ROLE: Official AI Support for myAutoBot.in.
      STRICT RULES:
      1. Answer using context. If unknown, ask for email.
      2. Tone: Professional, under 3 sentences.
      3. No AI model mentions.
      4. Today's Date: ${new Date().toDateString()}.`
    };

    const fullMessagePayload = [systemInstruction, ...historyForAI];

    // 5. CALL NEW LLM BRAIN
    const aiRes = await axios.post(`${process.env.CLOUDFLARE_URL}/chat/completions`, {
      model: activeBotId, 
      messages: fullMessagePayload,
      temperature: 0.4
    }, {
      headers: { 
        'Authorization': `Bearer ${process.env.BOT_API_KEY.trim()}`,
        'Content-Type': 'application/json'
      },
      timeout: 45000
    });
    
    console.log("Received AI response for message ID", messageId);
    const aiReply = aiRes.data?.choices?.[0]?.message?.content || "I'm currently experiencing high traffic. Could you please rephrase your request?";

    // 6. DISPATCH TO WHATSAPP
    await axios.post(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to: customerNumber,
      type: "text",
      text: { body: aiReply }
    }, {
      headers: { 'Authorization': `Bearer ${owner.whatsappToken}` }
    });
    
    console.log("Dispatched AI reply to WhatsApp for message ID", messageId);
    
    // 7. LOG AI REPLY
    await Conversation.updateOne(
      { user: owner._id, customerIdentifier: customerNumber },
      { $push: { messages: { role: 'bot', text: aiReply, source: 'whatsapp', timestamp: new Date() } } }
    );

  } catch (err) {
    console.error(`[CRITICAL] WhatsApp AI Error:`, err.response?.data || err.message);
    if (err.errors) console.error("Mongoose Validation Errors:", err.errors);

  } finally {
    release();
    userLocks.delete(customerNumber); 
    console.log(`Finished processing message ID ${messageId} from ${customerNumber}`);
  }
});


router.post("/whatsapp-test", async (req, res) => {
  const body = req.body;
  
  if (body.object !== "whatsapp_business_account") return res.sendStatus(404);
  console.log("Received WhatsApp Webhook:", JSON.stringify(body));
  res.sendStatus(200); 

  const entry = body.entry?.[0];
  const changes = entry?.changes?.[0]?.value;
  if (changes?.statuses) return; 

  const phoneNumberId = changes?.metadata?.phone_number_id;
  const message = changes?.messages?.[0];

  if (!message || !message.text || !phoneNumberId) return;

  const customerNumber = message.from;
  const userQuery = message.text.body.trim();
  const messageId = message.id; 

  try {

  await ProcessedMessage.create({
    messageId: messageId,
    customerNumber: customerNumber
  });

} catch (err) {

  if (err.code === 11000) {
    console.log("Duplicate webhook ignored:", messageId);
    return;
  }

  throw err;
}
  if (!userLocks.has(customerNumber)) userLocks.set(customerNumber, new Mutex());
  const release = await userLocks.get(customerNumber).acquire();

  console.log(`Processing test message from ${customerNumber}: "${userQuery}" (ID: ${messageId})`);

  try {
    // 1. DEDUPLICATION CHECK
    const existingMessage = await Conversation.findOne({
      customerIdentifier: customerNumber,
      "messages.messageId": messageId 
    }).lean();
    
    if (existingMessage) {
      console.log("Duplicate message ignored:", messageId);
      return; 
    }
   
    // 2. SAFE OWNER LOOKUP
    const owner = await User.findOne({ 
      $or: [
        { "botConfig.phoneNumberId": phoneNumberId }, 
        { "botConfig.phoneNumberId": Number(phoneNumberId) },
        { whatsappBusinessId: phoneNumberId }
      ] 
    }).lean();
    
    if (!owner || !owner._id) {
      console.error(`[CRITICAL] Owner not found for Phone ID: ${phoneNumberId}`);
      return;
    }

    // 3. UPDATE DB & GET HISTORY (Moved UP to always log incoming text)
    const conversation = await Conversation.findOneAndUpdate(
      { user: owner._id, customerIdentifier: customerNumber },
      {
        $push: { 
          messages: { 
            $each: [{ role: 'user', text: userQuery, source: 'whatsapp-test', timestamp: new Date(), messageId: messageId }],
            $slice: -15 
          } 
        },
        $set: { lastInteraction: new Date() },
        $setOnInsert: {
          user: owner._id,
          customerIdentifier: customerNumber,
          createdAt: new Date(),
          status: 'active' 
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );

    // 4. CHECK IF AI IS ENABLED (Moved DOWN)
    if (!owner.botConfig?.isManualPromptEnabled) {
      console.log(`Manual mode active for Owner ID: ${owner._id}. Message logged, skipping AI reply.`);
      return;
    }

    // --- EVERYTHING BELOW ONLY RUNS IF AI IS ON ---
    const historyForAI = conversation.messages.map(m => ({
      role: m.role === 'bot' ? 'assistant' : 'user',
      content: m.text
    }));

    const systemInstruction = {
      role: "system",
      content: `ROLE: Official AI Support for myAutoBot.in.
      STRICT RULES:
      1. Answer using context. If unknown, ask for email.
      2. Tone: Professional, under 3 sentences.
      3. No AI model mentions.
      4. Today's Date: ${new Date().toDateString()}.`
    };

    const fullMessagePayload = [systemInstruction, ...historyForAI];

    // 5. CALL FREE KEYLESS API (Pollinations.ai)
    console.log("Calling free Pollinations AI endpoint...");
    const aiRes = await axios.post(`https://text.pollinations.ai/openai`, {
      model: "openai", 
      messages: fullMessagePayload,
      temperature: 0.4
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 45000
    });
    
    const aiReply = aiRes.data?.choices?.[0]?.message?.content || "Testing mode: AI unavailable. Please try again.";
    console.log("AI Reply generated successfully for message ID", messageId);

    // 6. DISPATCH TO WHATSAPP
    await axios.post(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to: customerNumber,
      type: "text",
      text: { body: aiReply }
    }, {
      headers: { 'Authorization': `Bearer ${owner.whatsappToken}` }
    });
    
    // 7. LOG AI REPLY TO DATABASE
    await Conversation.updateOne(
      { user: owner._id, customerIdentifier: customerNumber },
      { $push: { messages: { role: 'bot', text: aiReply, source: 'whatsapp-test', timestamp: new Date() } } }
    );

  } catch (err) {
    console.error(`[CRITICAL] WhatsApp AI Error:`, err.response?.data || err.message);
    if (err.errors) console.error("Mongoose Validation Errors:", err.errors);
  } finally {
    release();
    userLocks.delete(customerNumber); 
    console.log(`Finished processing message ID ${messageId} from ${customerNumber}`);
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


// --- GET WHATSAPP CONVERSATIONS (Optimized) ---
router.get("/whatsapp-conversations", async (req, res) => {
  try {
    const { userId } = req.query; 
    
    if (!userId) {
      return res.status(400).json({ error: "Missing userId parameter" });
    }

    // Query DB: Only get conversations belonging to this user 
    // AND where at least one message has the source 'whatsapp' or 'whatsapp-test'
    const history = await Conversation.find({ 
      user: userId,
      "messages.source": { $in: ["whatsapp", "whatsapp-test"] }
    })
    .sort({ lastInteraction: -1 }) // Newest chats at the top
    .lean(); // .lean() makes the query significantly faster since we just need the JSON

    res.json(history);
  } catch (err) {
    console.error("Error fetching WhatsApp conversations:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;