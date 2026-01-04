const express = require('express');
const router = express.Router();
const BotConfig = require('../models/BotConfig');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const crypto = require('crypto');
const socialCtrl = require('../controllers/socialController');
const { decrypt } = require('../utils/encryption');
const SocialConfig = require('../models/SocialConfig');

// --- ENCRYPTION UTILITIES ---
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; 
const IV_LENGTH = 16;

function encrypt(text) {
  if (!text || typeof text !== 'string') return null;
  if (text.includes('***')) return undefined; 

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

// --- 1. AUTH MIDDLEWARE ---
const auth = async (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1];
  if (!token) return res.status(401).json({ message: "Access Denied" });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) return res.status(404).json({ message: "User not found" });
    
    req.user = user; 
    next();
  } catch (err) { 
    res.status(401).json({ message: "Invalid Token" }); 
  }
};

// --- 2. TOKEN DEDUCTION MIDDLEWARE ---
const deductTokens = async (req, res, next) => {
  const CHAT_COST = 5;
  try {
    const user = await User.findOneAndUpdate(
      { _id: req.user.id, tokens: { $gte: CHAT_COST } },
      { $inc: { tokens: -CHAT_COST } },
      { new: true }
    );
    if (!user) {
      return res.status(403).json({ 
        success: false, 
        message: "Insufficient Credits. Please top up.",
        currentBalance: req.user.tokens 
      });
    }
    req.updatedTokens = user.tokens;
    next();
  } catch (err) {
    res.status(500).json({ message: "Credit processing failed" });
  }
};
// --- PUBLIC: Webhook Handshake (For Meta Verification) ---
router.get('/webhook/meta', async (req, res) => {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge, botId } = req.query;

    if (mode === 'subscribe') {
        const config = await SocialConfig.findOne({ userId: botId });
        if (config && token === config.verifyToken) {
            console.log("✅ Meta Webhook Verified for botId:", botId);
            return res.status(200).send(challenge);
        }
    }
    res.sendStatus(403);
});

router.get('/config', auth, socialCtrl.getSettings);
router.post('/settings/update', auth, socialCtrl.updateSettings);

router.post('/webhook/meta', async (req, res) => {
    const { botId } = req.query; // Your Handshake URL has ?botId=...
    const body = req.body;

    // 1. Acknowledge receipt immediately to Meta (important to avoid 500 errors)
    res.status(200).send('EVENT_RECEIVED');

    try {
        // 2. Resolve the user's social configuration
        const config = await SocialConfig.findOne({ userId: botId });
        if (!config) return console.log("❌ Bot configuration not found for:", botId);

        /* --- WHATSAPP LOGIC --- */
        if (body.object === 'whatsapp_business_account' && config.whatsapp.enabled) {
            const entry = body.entry?.[0]?.changes?.[0]?.value;
            const message = entry?.messages?.[0];

            if (message?.type === 'text') {
                const customerPhone = message.from;
                const messageText = message.text.body;

                console.log(`\n--- 📥 WHATSAPP MESSAGE FROM ${customerPhone} ---`);
                
                // Process through AI Engine
                await handleSocialResponse(
                    botId, 
                    config.whatsapp.token, 
                    config.whatsapp.phoneNumberId, 
                    customerPhone, 
                    messageText, 
                    'whatsapp'
                );
            }
        }

        /* --- INSTAGRAM LOGIC --- */
        if (body.object === 'instagram' && config.instagram.enabled) {
            const entry = body.entry?.[0]?.messaging?.[0];
            const senderId = entry?.sender?.id;
            const messageText = entry?.message?.text;

            if (messageText && senderId) {
                console.log(`\n--- 📥 INSTAGRAM DM FROM ${senderId} ---`);
                
                // Process through AI Engine
                await handleSocialResponse(
                    botId, 
                    config.instagram.token, 
                    config.instagram.businessId, 
                    senderId, 
                    messageText, 
                    'instagram'
                );
            }
        }
    } catch (err) {
        console.error("🔥 Webhook Processing Error:", err.message);
    }
});

// --- 3. LIVE DEBUG CHAT (Neural Tester) ---
// This uses the prompt sent from the frontend to allow testing BEFORE saving.
router.post('/chat/debug', auth, deductTokens, async (req, res) => {
  try {
    const { message, activePrompt } = req.body;

    /**
     * AI INTEGRATION POINT:
     * Replace the mock logic below with your actual LLM call (OpenAI/Llama).
     * Pass 'activePrompt' as the 'system' message and 'message' as 'user' message.
     */
    const aiSimulatedReply = `[Node Response] Using current ${activePrompt ? 'active' : 'default'} architecture: I've processed "${message}". Neural status: Optimized.`;

    res.json({ 
      success: true, 
      reply: aiSimulatedReply,
      tokensRemaining: req.updatedTokens 
    });

  } catch (err) {
    res.status(500).json({ success: false, message: "AI Handshake Error" });
  }
});
// --- GET CONFIG: Hydrate Frontend ---
router.get('/config', auth, async (req, res) => {
  try {
    const config = await BotConfig.findOne({ user: req.user.id });
    
    // Return the config + user's current token balance
    res.json({
      success: true,
      botConfig: config || null,
      userTokens: req.user.tokens // Assuming 'tokens' is on your User model
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "VPS Uplink Error" });
  }
});

// --- POST SAVE: Synchronize Engine ---
router.post("/save", auth, async (req, res) => {
  try {
    const { 
      status, model, systemPrompt, customSystemPrompt, 
      isManualPromptEnabled, ragFile, isCustomRagEnabled, rawData 
    } = req.body;

    // Validation: Engine requires a name to initialize
    if (!rawData?.businessName?.trim()) {
      return res.status(400).json({ success: false, message: "Business Name is required." });
    }

    const botConfig = await BotConfig.findOneAndUpdate(
      { user: req.user.id },
      {
        $set: {
          status: status || 'draft',
          model,
          systemPrompt,
          customSystemPrompt,
          isManualPromptEnabled,
          ragFile,
          isCustomRagEnabled,
          rawData,
          lastUpdated: Date.now()
        }
      },
      { upsert: true, new: true, runValidators: true }
    );

    res.json({ success: true, botConfig });
  } catch (err) {
    console.error("SAVE ERROR:", err);
    res.status(500).json({ success: false, message: "Database Write Failed" });
  }
});
// --- 6. INTEGRATION VERIFY & UPDATE ---
router.post('/settings/verify', auth, async (req, res) => {
  const { platform, id, token: bodyToken } = req.body; 
  try {
    const config = await BotConfig.findOne({ user: req.user.id });
    let activeToken = null;

    if (bodyToken && !bodyToken.includes('***')) {
      activeToken = bodyToken.trim();
    } else if (config) {
      const encryptedToken = platform === 'whatsapp' ? config.whatsappToken : config.instagramToken;
      if (encryptedToken && encryptedToken !== "********************") {
        activeToken = decrypt(encryptedToken);
      }
    }

    let targetId = id || (platform === 'whatsapp' ? config?.phoneNumberId : config?.instagramBusinessId);
    if (!activeToken || !targetId) {
      return res.status(400).json({ valid: false, message: "Missing Access Credentials" });
    }

    const url = `https://graph.facebook.com/v21.0/${targetId}${platform === 'instagram' ? '?fields=name' : ''}`;
    const response = await axios.get(url, { headers: { Authorization: `Bearer ${activeToken}` } });

    res.json({ valid: response.status === 200 });
  } catch (err) {
    res.json({ valid: false, error: err.response?.data?.error?.message || "Meta Handshake Failed" });
  }
});

router.post('/settings/update', auth, async (req, res) => {
  const { whatsappToken, instagramToken, phoneNumberId, instagramBusinessId } = req.body;
  try {
    const updateData = { lastUpdated: Date.now() };
    if (whatsappToken && !whatsappToken.includes('****')) updateData.whatsappToken = encrypt(whatsappToken);
    if (instagramToken && !instagramToken.includes('****')) updateData.instagramToken = encrypt(instagramToken);
    if (phoneNumberId) updateData.phoneNumberId = phoneNumberId;
    if (instagramBusinessId) updateData.instagramBusinessId = instagramBusinessId;

    await BotConfig.findOneAndUpdate({ user: req.user.id }, { $set: updateData }, { upsert: true });
    res.json({ success: true, message: "Integrations Synchronized" });
  } catch (err) {
    res.status(500).json({ message: "Error saving integration credentials" });
  }
});

module.exports = router;