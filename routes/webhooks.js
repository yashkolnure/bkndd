const express = require('express');
const router = express.Router();
const BotConfig = require('../models/BotConfig');
const axios = require('axios');
const { decrypt } = require('../utils/encryption'); // You'll need a decryption helper

// GET: https://myautobot.in/api/webhooks/meta
router.get('/meta', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // This 'verifyToken' must match the one you set in your Dashboard and React frontend
    const verifyToken = process.env.WEBHOOK_VERIFY_TOKEN;

    if (mode && token) {
        if (mode === 'subscribe' && token === verifyToken) {
            console.log('WEBHOOK_VERIFIED');
            return res.status(200).send(challenge);
        } else {
            return res.sendStatus(403);
        }
    }
});

// POST: https://myautobot.in/api/webhooks/meta
router.post('/meta', async (req, res) => {
    const body = req.body;

    // 1. Immediately acknowledge receipt to Meta (prevents retry loops)
    res.status(200).send('EVENT_RECEIVED');

    try {
        let messageText = '';
        let senderId = '';
        let platform = '';

        // --- DETECT WHATSAPP DATA ---
        if (body.object === 'whatsapp_business_account') {
            platform = 'whatsapp';
            const entry = body.entry?.[0]?.changes?.[0]?.value;
            const message = entry?.messages?.[0];
            
            if (message?.type === 'text') {
                messageText = message.text.body;
                senderId = message.from; // User's phone number
            }
        }

        // --- DETECT INSTAGRAM DATA ---
        else if (body.object === 'instagram') {
            platform = 'instagram';
            const messaging = body.entry?.[0]?.messaging?.[0];
            
            if (messaging?.message?.text) {
                messageText = messaging.message.text;
                senderId = messaging.sender.id; // User's scoped ID
            }
        }

        if (!messageText || !senderId) return;

        // 2. FETCH USER CONFIG FROM DATABASE
        // You need the stored Token to reply
        const botOwner = await User.findOne({ 
            $or: [{ whatsappBusinessId: body.entry[0].id }, { instagramBusinessId: body.entry[0].id }] 
        });

        if (!botOwner) return console.error("No bot owner found for this ID");

        // 3. CALL YOUR LLM (AI LOGIC)
        // const aiResponse = await callMyLLM(messageText, senderId);
        const aiResponse = `Hello from MyAutoBot! You said: ${messageText}`;

        // 4. SEND REPLY BACK TO USER
        await sendMetaReply(platform, senderId, aiResponse, botOwner);

    } catch (error) {
        console.error("Webhook Processing Error:", error.message);
    }
});