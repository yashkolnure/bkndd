
const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();
const axios = require('axios');
const jwt = require('jsonwebtoken');

// Models
const BotConfig = require('../models/BotConfig');
const Conversation = require('../models/Conversation');
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
router.get('/public-info/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        // 1. Validate ID format to prevent database errors
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: "Invalid ID format" });
        }

        // 2. Fetch User and project botConfig including ragFile and systemPrompt
        // Adding 'botConfig' to the projection pulls all nested fields
        const user = await User.findById(userId, 'botConfig').lean();

        if (!user || !user.botConfig) {
            return res.status(404).json({ success: false, message: "Bot configuration not found" });
        }

        // 3. Return data including the compiled RAG and System Prompt
        return res.json({
            success: true,
            status: user.botConfig.status,
            // Core Identity
            businessName: user.botConfig.rawData.businessName,
            businessDescription: user.botConfig.rawData.businessDescription,
            language: user.botConfig.rawData.language,
            
            // Intelligence Config
            model: user.botConfig.model.primary,
            agentType: user.botConfig.rawData.agentType,
            
            // Passing the compiled prompts
            systemPrompt: user.botConfig.systemPrompt || "", 
            ragFile: user.botConfig.ragFile || ""
        });

    } catch (err) {
        console.error("Public Bot Info Error:", err);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});
/**
 * --- 5. PUBLIC: CHAT INTERFACE (Lead Scanning + Tokens) ---
 */router.post('/public-message/:userId', async (req, res) => {
    const { message, customerData } = req.body;
    const { userId } = req.params;
    const CHAT_COST = 5;

    console.log(`\n--- [NEURAL REQUEST START] Node ID: ${userId} ---`);

    // 1. Validation
    if (!message || message.trim().length === 0) {
        console.log("❌ Debug: Empty message received.");
        return res.status(400).json({ success: false, message: "Transmission empty." });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
        console.log(`❌ Debug: Invalid ID format [${userId}]`);
        return res.status(400).json({ success: false, message: "Invalid Neural Node ID format." });
    }

    try {
        // 2. ATOMIC FETCH & DEDUCTION
        console.log("Step 2: Authenticating Node & Deducting Credits...");
        const user = await User.findOneAndUpdate(
            { 
                _id: new mongoose.Types.ObjectId(userId), 
                "botConfig.status": "active", 
                tokens: { $gte: CHAT_COST } 
            },
            { $inc: { tokens: -CHAT_COST } },
            { new: true }
        ).lean();

        if (!user) {
            console.log("❌ Debug: Auth failed - Either ID is wrong, status is not 'active', or tokens < 5");
            return res.status(403).json({ 
                success: false, 
                message: "Neural Node is offline. Inactive or Insufficient Credits." 
            });
        }

        // 3. RETRIEVE CONVERSATION MEMORY
        console.log(`Step 3: Fetching memory for customer: ${customerData?.name || "Guest"}`);
        const displayName = customerData?.name || "Guest";
        const conversationHistory = await Conversation.findOne({ 
            user: user._id, 
            customerIdentifier: displayName 
        }).lean();

        const memoryLimit = 6;
        const pastMessages = conversationHistory 
            ? conversationHistory.messages.slice(-memoryLimit).map(m => ({
                role: m.role === 'user' ? 'user' : 'assistant',
                content: m.text
            })) 
            : [];

        // 4. PREPARE PAYLOAD
        const { systemPrompt, ragFile, model } = user.botConfig;
        const vpsPayload = {
            model: model?.primary || "llama3",
            messages: [
                { role: "system", content: `${systemPrompt}\n\n[KNOWLEDGE_BASE]\n${ragFile}`.trim() },
                ...pastMessages,
                { role: "user", content: message }
            ],
            stream: false,
            options: {
                num_thread: 24, 
                temperature: 0.2,
                num_ctx: 4096
            }
        };

        // 5. VPS AI REQUEST WITH DEEP DEBUGGING
        console.log(`Step 5: Sending Request to AI Engine: ${process.env.VPS_AI_URL}/api/chat`);
        let botReply = "";
        try {
            const aiStartTime = Date.now();
            const aiResponse = await axios.post(
                `${process.env.VPS_AI_URL}/api/chat`,
                vpsPayload,
                { timeout: 120000 } 
            );
            const aiEndTime = Date.now();
            console.log(`✅ Step 5 Success: AI responded in ${((aiEndTime - aiStartTime) / 1000).toFixed(2)}s`);
            
            botReply = aiResponse.data?.message?.content || "Engine synthesis failed.";
        } catch (apiErr) {
            console.error("\n--- [AI ENGINE CRITICAL ERROR] ---");
            console.error("Error Code:", apiErr.code); // e.g. ECONNREFUSED
            console.error("Error Message:", apiErr.message);
            
            if (apiErr.response) {
                // The server responded with a status code (404, 500, etc)
                console.error("Status Code:", apiErr.response.status);
                console.error("Response Data:", apiErr.response.data);
            } else if (apiErr.request) {
                // The request was made but no response was received
                console.error("No response received from Engine. Is OLLAMA_HOST set to 0.0.0.0?");
            }

            console.log("🔄 Triggering Token Refund...");
            await User.findByIdAndUpdate(user._id, { $inc: { tokens: CHAT_COST } });

            return res.status(502).json({
                success: false,
                message: "Neural Engine connection failed. Tokens have been refunded.",
                debug_code: apiErr.code
            });
        }

        // 6. CONVERSATION LOGGING
        console.log("Step 6: Archiving transaction to history...");
        await Conversation.findOneAndUpdate(
            { user: user._id, customerIdentifier: displayName },
            {
                $push: {
                    messages: [
                        { role: 'user', text: message, timestamp: new Date() },
                        { role: 'bot', text: botReply, timestamp: new Date() }
                    ]
                },
                $set: { lastInteraction: new Date() }
            },
            { upsert: true }
        );

        // 7. FINAL SUCCESS RESPONSE
        console.log(`--- [NEURAL REQUEST SUCCESS] New Balance: ${user.tokens} ---\n`);
        return res.json({ 
            success: true, 
            response: botReply,
            remainingTokens: user.tokens 
        });

    } catch (err) {
        console.error("\n🔥 [GENERAL SYSTEM CRASH] 🔥");
        console.error(err.stack);
        return res.status(500).json({
            success: false,
            message: "System anomaly detected."
        });
    }
});

/**
 * NEURAL DIAGNOSTICS ROUTE
 * Use this to verify why a User ID is being blocked.
 * GET /api/chat/debug/:userId
 */

router.get('/debug/:userId', async (req, res) => {
    const { userId } = req.params;

    // Validate if the ID is a valid MongoDB format to avoid crashes
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ 
            success: false, 
            diagnosis: "Invalid ID Format. The string must be a 24-character hex ID.",
            providedId: userId 
        });
    }

    try {
        // Fetch raw document using .lean() to see exact BSON values
        const user = await User.findById(userId).lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                diagnosis: "User NOT FOUND in database. Ensure you are using the correct _id from the Users collection.",
                providedId: userId
            });
        }

        // Logic Check results
        const checks = {
            statusCheck: user.botConfig?.status === 'active' ? "✅ PASS" : "❌ FAIL (Must be 'active')",
            tokenCheck: user.tokens >= 5 ? "✅ PASS" : "❌ FAIL (Need at least 5 tokens)",
            systemPromptCheck: (user.botConfig?.systemPrompt?.length > 0) ? "✅ PASS" : "⚠️ WARNING (Empty Prompt)",
            ragFileCheck: (user.botConfig?.ragFile?.length > 0) ? "✅ PASS" : "⚠️ WARNING (Empty RAG Content)"
        };

        // Final Verdict
        const canRespond = user.botConfig?.status === 'active' && user.tokens >= 5;

        return res.json({
            success: true,
            verdict: canRespond ? "READY_TO_CHAT" : "BLOCKED",
            analysis: {
                userName: user.name,
                currentTokens: user.tokens,
                botStatus: user.botConfig?.status,
                primaryModel: user.botConfig?.model?.primary,
                diagnostics: checks
            },
            // Metadata for developer review
            dataPreview: {
                systemPromptPreview: user.botConfig?.systemPrompt ? `${user.botConfig.systemPrompt.substring(0, 50)}...` : "EMPTY",
                ragContentPreview: user.botConfig?.ragFile ? `${user.botConfig.ragFile.substring(0, 50)}...` : "EMPTY"
            }
        });

    } catch (err) {
        console.error("Debug Error:", err.message);
        return res.status(500).json({ success: false, error: err.message });
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