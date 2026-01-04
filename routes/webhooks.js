const express = require('express');
const router = express.Router();
const BotConfig = require('../models/BotConfig');
const axios = require('axios');
const { decrypt } = require('../utils/encryption'); // You'll need a decryption helper

router.get('/meta', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // This token must match exactly what you told your users to use: 'avenirya_secret'
    if (mode === 'subscribe' && token === 'avenirya_secret') {
        console.log('WEBHOOK_VERIFIED');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

router.post('/meta', async (req, res) => {
    const { botId } = req.query; // Your users use: .../api/webhooks/meta?botId=USER_ID
    const body = req.body;

    // 1. Validate this is a message event
    const messageObj = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!messageObj || !messageObj.text) return res.sendStatus(200);

    try {
        // 2. Fetch this specific user's configuration
        const config = await BotConfig.findOne({ user: botId });
        if (!config || !config.whatsappToken) return res.sendStatus(200);

        const customerMsg = messageObj.text.body;
        const customerId = messageObj.from; // Phone number or IG ID

        // 3. Forward to the Self-Hosted LLM on your VPS
        // We pass the unique 'instructions' the user wrote during onboarding
        const aiResponse = await axios.post('http://YOUR_VPS_IP:8000/v1/chat/completions', {
            model: "llama-3.2-1b",
            messages: [
                { role: "system", content: config.instructions },
                { role: "user", content: customerMsg }
            ]
        });

        const botReply = aiResponse.data.choices[0].message.content;

        // 4. Send the AI response back to the customer via Meta
        await axios.post(`https://graph.facebook.com/v17.0/${config.phoneNumberId}/messages`, {
            messaging_product: "whatsapp",
            to: customerId,
            text: { body: botReply }
        }, {
            headers: { 
                Authorization: `Bearer ${decrypt(config.whatsappToken)}`,
                'Content-Type': 'application/json'
            }
        });

    } catch (err) {
        console.error("SaaS Webhook Error:", err.message);
    }

    // Always send 200 back to Meta so they don't keep retrying the same message
    res.sendStatus(200);
});