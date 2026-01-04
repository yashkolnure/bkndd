const express = require('express');
const router = express.Router();
const axios = require('axios');
const jwt = require('jsonwebtoken');

// Models
const BotConfig = require('../models/BotConfig');
const Conversation = require('../models/Conversation');
const Lead = require('../models/Lead');
const User = require('../models/User');

const captureLead = require('../helpers/leadEngine');


/**
 * --- 2. MIDDLEWARE: PRIVATE AUTH ---
 */
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
        res.status(401).json({ message: "Invalid token" });
    }
};

/**
 * --- 3. PRIVATE: DASHBOARD DEBUG CHAT ---
 */
router.post('/message', auth, async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ message: "Message is required." });

    try {
        const config = await BotConfig.findOne({ user: req.user.id });
        
        if (!config) return res.status(404).json({ message: "Train your AI first." });

        const vpsPayload = {
            model: "llama3.2:1b",
            prompt: `System: ${config.instructions}\n\nCustomer: ${message}\nAI Assistant:`,
            stream: false
        };

        const aiResponse = await axios.post(`${process.env.VPS_AI_URL}/api/generate`, vpsPayload, { timeout: 15000 });
        res.json({ response: aiResponse.data.response });
    } catch (err) {
        res.status(500).json({ message: "AI Engine Offline" });
    }
});

/**
 * --- 4. PUBLIC: FETCH BOT INFO ---
 */

router.get('/public-info/:botId', async (req, res) => {
    try {
        const { botId } = req.params;

        // 1. Resolve BotConfig (by botId or userId)
        let botConfig = await BotConfig.findById(botId).catch(() => null);

        if (!botConfig) {
            botConfig = await BotConfig.findOne({ user: botId });
        }

        if (!botConfig) {
            return res.status(404).json({ message: "Bot not found" });
        }

        // 2. Return ONLY public-safe data
        return res.json({
            businessName: botConfig.rawData.businessName,
            businessDescription: botConfig.rawData.businessDescription,
            language: botConfig.rawData.language,
            status: botConfig.status,
            model: botConfig.model.primary
        });

    } catch (err) {
        console.error("Public Bot Info Error:", err);
        return res.status(400).json({ message: "Invalid bot ID" });
    }
});

/**
 * --- 5. PUBLIC: CHAT INTERFACE (Lead Scanning + Tokens) ---
 */
router.post('/public-message/:botId', async (req, res) => {
    const { message, customerData } = req.body;
    const { botId } = req.params;
    const CHAT_COST = 5;

    // --- LOG 1: Incoming Traffic ---
    console.log("\n--- 📥 NEW INCOMING MESSAGE ---");
    console.log(`Bot ID: ${botId}`);
    console.log(`Message: "${message}"`);
    console.log(`Customer Data:`, customerData);

    if (!message) {
        return res.status(400).json({ success: false, message: "Transmission empty." });
    }

    try {
        /* ---------------- 1. RESOLVE NEURAL NODE ---------------- */
        let botConfig = await BotConfig.findById(botId).catch(() => null);
        if (!botConfig) {
            botConfig = await BotConfig.findOne({ user: botId });
        }

        if (!botConfig) {
            console.log("❌ ERROR: Bot configuration not found in database.");
            return res.status(404).json({ success: false, message: "Neural Node not found." });
        }

        if (botConfig.status !== 'active') {
            console.log("⚠️ WARNING: Bot found but status is:", botConfig.status);
            return res.status(404).json({ success: false, message: "Neural Node is inactive." });
        }

        /* ---------------- 2. TOKEN DEDUCTION ---------------- */
        const owner = await User.findOneAndUpdate(
            { _id: botConfig.user, tokens: { $gte: CHAT_COST } },
            { $inc: { tokens: -CHAT_COST } },
            { new: true }
        );

        if (!owner) {
            console.log("❌ ERROR: Insufficient tokens for user ID:", botConfig.user);
            return res.status(403).json({
                success: false,
                message: "Neural Engine offline. Please contact the business owner for credits."
            });
        }
        console.log(`✅ TOKENS DEDUCTED. Remaining: ${owner.tokens}`);

        const displayName = customerData?.name || "Guest";

        /* ---------------- 3. LEAD CAPTURE (ASYNC) ---------------- */
        const processLeads = async () => {
            try {
                const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
                const phoneRegex = /(\+?\d{1,4}[\s-]?)?[\d\s-]{7,15}/g;

                const foundEmails = message.match(emailRegex) || [];
                const foundPhones = message.match(phoneRegex) || [];

                if (foundEmails.length > 0 || foundPhones.length > 0) {
                    console.log(`🎯 LEAD DETECTED: Emails: ${foundEmails}, Phones: ${foundPhones}`);
                }
            } catch (e) {
                console.error("Lead Capture Error:", e);
            }
        };
        processLeads(); 

        /* ---------------- 4. BUILD DYNAMIC PROMPT ---------------- */
        // This is where we verify if Manual or Auto settings are working
        const systemMessage = `
${botConfig.systemPrompt}

### BUSINESS CONTEXT (KNOWLEDGE BASE)
${botConfig.ragFile}

### SESSION METADATA
- Customer Name: ${displayName}
- Language: ${botConfig.rawData?.language || 'English'}
- Timestamp: ${new Date().toISOString()}
`.trim();

        // --- LOG 2: Compiled AI Brain ---
        console.log("--- 🧠 COMPILED SYSTEM MESSAGE ---");
        console.log(systemMessage);
        console.log("----------------------------------");

        /* ---------------- 5. VPS OLLAMA REQUEST ---------------- */
        const vpsPayload = {
            model: botConfig.model?.primary || "llama3.2",
            messages: [
                { role: "system", content: systemMessage },
                { role: "user", content: message }
            ],
            stream: false,
            options: {
                num_thread: 8,
                temperature: 0.3
            }
        };

        // --- LOG 3: Outgoing Payload ---
        console.log("🚀 SENDING TO VPS...");
        console.log(`URL: ${process.env.VPS_AI_URL}/api/chat`);
        console.log(`Model Used: ${vpsPayload.model}`);

        const aiResponse = await axios.post(
            `${process.env.VPS_AI_URL}/api/chat`,
            vpsPayload,
            { timeout: 60000 }
        );

        const botText = aiResponse.data?.message?.content || "Engine failed to generate response.";

        // --- LOG 4: AI Reply ---
        console.log("🤖 AI RESPONSE RECEIVED:");
        console.log(botText);

        /* ---------------- 6. LOG CONVERSATION ---------------- */
        Conversation.findOneAndUpdate(
            { user: botConfig.user, customerIdentifier: displayName },
            {
                $push: {
                    messages: [
                        { role: 'user', text: message, timestamp: new Date() },
                        { role: 'bot', text: botText, timestamp: new Date() }
                    ]
                },
                $set: { lastInteraction: new Date() }
            },
            { upsert: true }
        ).catch(err => console.error("Conversation Log Error:", err));

        /* ---------------- 7. RESPOND ---------------- */
        console.log("✅ REQUEST COMPLETED SUCCESSFULLY\n");
        return res.json({ success: true, response: botText });

    } catch (err) {
        console.log("🔥 CRITICAL ENGINE ERROR LOGGED:");
        if (err.response) {
            console.error("VPS Response Error:", err.response.data);
        } else {
            console.error("Error Message:", err.message);
        }

        return res.status(502).json({
            success: false,
            message: "Neural Engine temporarily disconnected. Please try again."
        });
    }
});
/**
 * --- 6. PRIVATE: GET USER CHAT HISTORY ---
 */
router.get('/history', auth, async (req, res) => {
    try {
        const history = await Conversation.find({ user: req.user.id }).sort({ lastInteraction: -1 });
        res.json(history);
    } catch (err) {
        res.status(500).json({ message: "Error fetching history." });
    }
});

module.exports = router;