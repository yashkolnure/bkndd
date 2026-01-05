const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); 
const sendEmail = require('../utils/sendEmail');
const User = require('../models/User');
const axios = require('axios');


router.get('/callback', async (req, res) => {
    const { code, platform } = req.query;
    const REDIRECT_URI = 'https://myautobot.in/api/auth/callback/';

    try {
        const tokenRes = await axios.get(`https://graph.facebook.com/v24.0/oauth/access_token`, {
            params: {
                client_id: process.env.META_APP_ID,
                client_secret: process.env.META_APP_SECRET,
                code: code,
                // MUST match the frontend string exactly
                redirect_uri: REDIRECT_URI 
            }
        });

        const systemToken = tokenRes.data.access_token;

        // 2. Platform-Specific Discovery
        let igData = null;
        let waData = null;

        // Fetch Instagram/Pages regardless (common assets)
        const accountsRes = await axios.get(`https://graph.facebook.com/v24.0/me/accounts`, {
            params: { 
                fields: 'instagram_business_account,access_token,name',
                access_token: systemToken 
            }
        });
        igData = accountsRes.data.data.find(p => p.instagram_business_account);

        // ONLY attempt WhatsApp discovery if the platform isn't strictly 'instagram'
        if (platform !== 'instagram') {
            try {
                const waRes = await axios.get(`https://graph.facebook.com/v24.0/me/whatsapp_business_accounts`, {
                    params: { access_token: systemToken }
                });
                waData = waRes.data.data?.[0]?.id;
            } catch (e) {
                console.log("Skipping WhatsApp discovery for this session.");
            }
        }

        // 3. Save to User Profile
        await User.findByIdAndUpdate(req.user.id, {
            instagramToken: igData?.access_token || systemToken,
            instagramBusinessId: igData?.instagram_business_account?.id,
            whatsappBusinessId: waData,
            instagramEnabled: !!igData,
            whatsappEnabled: !!waData
        });

        res.redirect('https://myautobot.in/dashboard/integrations?status=success');

    } catch (error) {
        console.error("Discovery Error:", error.response?.data || error.message);
        res.redirect('https://myautobot.in/dashboard/integrations?status=error');
    }
});

// GET myautobot.in/api/auth/webhook
router.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // Check if the mode and token sent match your .env variable
    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
        console.log('WEBHOOK_VERIFIED');
        res.status(200).send(challenge); // You MUST return the challenge string
    } else {
        res.sendStatus(403);
    }
});

// POST myautobot.in/api/auth/webhook
router.post('/webhook', async (req, res) => {
    const body = req.body;

    // Check if this is a message from Instagram or WhatsApp
    if (body.object === 'instagram' || body.object === 'whatsapp_business_account') {
        const entry = body.entry[0];
        
        // 1. Identify the message source
        const messaging = entry.messaging ? entry.messaging[0] : null;
        const changes = entry.changes ? entry.changes[0] : null;

        const senderId = messaging?.sender?.id || changes?.value?.messages?.[0]?.from;
        const messageText = messaging?.message?.text || changes?.value?.messages?.[0]?.text?.body;
        const recipientId = entry.id; // This matches the Business ID in your DB

        if (!messageText) return res.sendStatus(200);

        try {
            // 2. Find the bot owner in your DB
            const botOwner = await User.findOne({ 
                $or: [{ instagramBusinessId: recipientId }, { whatsappBusinessId: recipientId }] 
            });

            if (!botOwner || botOwner.tokens < 5) return res.sendStatus(200);

            // 3. SEND TO OLLAMA (Your self-hosted model)
            const aiResponse = await axios.post('http://YOUR_VPS_IP:11434/api/generate', {
                model: "llama3.2",
                prompt: `User Query: ${messageText}`, // You can add your custom system prompt here
                stream: false
            });

            const reply = aiResponse.data.response;

            // 4. DEDUCT TOKENS
            await User.findByIdAndUpdate(botOwner._id, { $inc: { tokens: -5 } });

            // 5. REPLY TO USER (I'll provide the sendReply helper next)
            await sendReply(senderId, reply, botOwner.instagramToken);

        } catch (err) {
            console.error("Processing Error:", err.message);
        }

        res.sendStatus(200); // Always send 200 OK immediately to Meta
    } else {
        res.sendStatus(404);
    }
});

// --- 1. REGISTER ---
router.post('/register', async (req, res) => {
  // Normalize email to lowercase
  const { name, password } = req.body;
  const email = req.body.email.toLowerCase().trim();

  try {
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ message: "Node already exists in network" });

    user = new User({ name, email, password });
    
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user: { id: user._id, name: user.name } });
  } catch (err) {
    res.status(500).send("Registration Error");
  }
});

// --- 2. LOGIN ---
router.post('/login', async (req, res) => {
  // Normalize email to lowercase
  const { password } = req.body;
  const email = req.body.email.toLowerCase().trim();

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Invalid Credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid Credentials" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user: { id: user._id, name: user.name } });
  } catch (err) {
    res.status(500).send("Login Error");
  }
});


router.post('/forgot-password', async (req, res) => {
  const email = req.body.email.toLowerCase().trim();

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "Identity node not found." });

    // 1. Generate Plain Token for URL
    const resetToken = crypto.randomBytes(20).toString('hex');

    // 2. Save SHA-256 Hashed Token to Database for Security
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpires = Date.now() + 3600000; // 1 Hour Expiry

    await user.save();

    // 3. Construct Reset URL (Points to your new ResetPassword.jsx page)
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

    // 4. Industrial MyAutoBot HTML Template
    const htmlContent = `
      <div style="background-color: #05010d; color: #ffffff; padding: 50px; font-family: 'Segoe UI', Tahoma, sans-serif; border-radius: 24px; text-align: center;">
        <h2 style="color: #a855f7; text-transform: uppercase; letter-spacing: 4px; font-style: italic;">Access Key Reset</h2>
        <p style="color: #64748b; font-size: 14px; margin-bottom: 30px;">A security bypass was requested for your MyAutoBot node.</p>
        <div style="margin: 40px 0;">
          <a href="${resetUrl}" style="background-color: #9333ea; color: #ffffff; padding: 18px 32px; text-decoration: none; border-radius: 12px; font-weight: 900; text-transform: uppercase; font-size: 12px; letter-spacing: 2px; box-shadow: 0 10px 20px -5px rgba(147, 51, 234, 0.5);">
            Authorize Recalibration
          </a>
        </div>
        <p style="font-size: 10px; color: #334155; text-transform: uppercase; letter-spacing: 1px;">
          Link expires in 60 minutes. If you did not initiate this, secure your node immediately.
        </p>
        <p style="font-size: 9px; color: #1e293b; margin-top: 20px; text-transform: uppercase;">System: MyAutoBot Core</p>
      </div>
    `;

    // 5. Dispatch Email via your WordPress SMTP
    await sendEmail({
      email: user.email,
      subject: 'MyAutoBot Security: Password Reset Protocol',
      html: htmlContent
    });

    res.json({ message: "Security link dispatched to your inbox." });
  } catch (err) {
    console.error("Mailer Error:", err);
    res.status(500).json({ message: "Neural dispatch failed. Check SMTP config." });
  }
});
// --- 4. RESET PASSWORD ---
router.post('/reset-password/:token', async (req, res) => {
  // Hash the token from the URL to compare with the DB version
  const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

  try {
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() } // Must not be expired
    });

    if (!user) return res.status(400).json({ message: "Token is invalid or has expired" });

    // Set & Hash new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(req.body.password, salt);

    // Clear reset credentials
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();

    res.json({ message: "Credentials recalibrated successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update node security" });
  }
});

// --- GET ALL USERS (Admin Only) ---
router.get('/admin/users', async (req, res) => {
  try {
    // Select name, email, contact, and createdAt (excluding password)
    const users = await User.find({}).select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch node network data." });
  }
});

// --- DELETE USER ---
router.delete('/admin/user/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "Node successfully decommissioned." });
  } catch (err) {
    res.status(500).json({ message: "Error removing node." });
  }
});

module.exports = router;