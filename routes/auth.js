const axios = require("axios");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const sendEmail = require("../utils/sendEmail");
const sendReply = require("../utils/sendReply");

/* =========================================================
   META OAUTH CALLBACK (JS SDK SAFE, PRODUCTION READY)
========================================================= */
const express = require("express");
const router = express.Router();

/* =====================================================
   META CONNECT (EMBEDDED SIGNUP – OFFICIAL)
===================================================== */
router.post("/meta-connect", async (req, res) => {
  const { platform, userId } = req.body;

  console.log("META CONNECT PAYLOAD:", req.body);

  if (!platform || !userId) {
    return res.status(400).json({ message: "Missing params" });
  }

  try {
    const SYSTEM_TOKEN = process.env.META_SYSTEM_USER_TOKEN;

    /* 1. Discover Assets */
    const accountsRes = await axios.get(
      "https://graph.facebook.com/v24.0/me/accounts",
      {
        params: {
          fields: "instagram_business_account,whatsapp_business_account",
          access_token: SYSTEM_TOKEN
        }
      }
    );

    let instagramBusinessId = null;
    let whatsappBusinessId = null;

    for (const page of accountsRes.data.data || []) {
      if (page.instagram_business_account) {
        instagramBusinessId = page.instagram_business_account.id;
      }
      if (page.whatsapp_business_account) {
        whatsappBusinessId = page.whatsapp_business_account.id;
      }
    }

    /* 2. Save */
    await User.findByIdAndUpdate(userId, {
      instagramEnabled: !!instagramBusinessId,
      whatsappEnabled: !!whatsappBusinessId,
      instagramBusinessId,
      whatsappBusinessId,
      instagramToken: SYSTEM_TOKEN,
      whatsappToken: SYSTEM_TOKEN
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("META CONNECT ERROR FULL:", err.response?.data || err.message);
    return res.status(500).json({ message: "Meta connect failed" });
  }
});

/* =====================================================
   META WEBHOOK (IG + WHATSAPP)
===================================================== */
router.get("/webhook", (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === process.env.META_VERIFY_TOKEN
  ) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

router.post("/webhook", async (req, res) => {
  res.sendStatus(200); // handle messages later
});


/* =========================================================
   AUTH: REGISTER
========================================================= */
router.post("/register", async (req, res) => {
  const { name, password } = req.body;
  const email = req.body.email.toLowerCase().trim();

  try {
    if (await User.findOne({ email })) {
      return res.status(400).json({ message: "User exists" });
    }

    const user = new User({ name, email, password });
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    await user.save();

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      token,
      user: { id: user._id, name: user.name }
    });
  } catch {
    res.status(500).json({ message: "Registration failed" });
  }
});

/* =========================================================
   AUTH: LOGIN
========================================================= */
// routes/auth.js

router.get("/webhooks/instagram", (req, res) => {
  const VERIFY_TOKEN = "my_verify_token";

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});


router.post("/webhooks/instagram", (req, res) => {
  console.log("IG Webhook:", JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

router.post("/login", async (req, res) => {
  // 1. Sanitize input to match registration logic
  const email = req.body.email?.toLowerCase().trim();
  const { password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password required" });
  }

  try {
    // 2. Find user and include necessary fields
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // 3. Compare hash
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // 4. Sign JWT
    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    // 5. Response structure (Unified for Frontend)
    res.status(200).json({
      token,
      user: {
        id: user._id.toString(), // Explicitly convert to string
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error("Login Protocol Error:", error);
    res.status(500).json({ message: "Internal server link failure" });
  }
});



router.post("/meta-connect", async (req, res) => {


  const { code, platform, userId } = req.body;
  console.log("META CONNECT PAYLOAD:", {
  code: !!code,
  platform,
  userId,
});

  if (!code || !platform || !userId) {
    return res.status(400).json({ message: "Missing params" });
  }

  try {
    // 1. Exchange code (JS SDK SAFE)
    const tokenRes = await axios.post(
      "https://graph.facebook.com/v24.0/oauth/access_token",
      null,
      {
        params: {
          client_id: process.env.META_APP_ID,
          client_secret: process.env.META_APP_SECRET,
          code,
          redirect_uri: "" // MUST be empty
        }
      }
    );

    const userAccessToken = tokenRes.data.access_token;

    // 2. Discover assets
    const accountsRes = await axios.get(
      "https://graph.facebook.com/v24.0/me/accounts",
      {
        params: {
          fields: "instagram_business_account,whatsapp_business_account",
          access_token: userAccessToken
        }
      }
    );

    let instagramBusinessId = null;
    let whatsappBusinessId = null;

    for (const page of accountsRes.data.data || []) {
      if (platform === "instagram" && page.instagram_business_account) {
        instagramBusinessId = page.instagram_business_account.id;
      }
      if (platform === "whatsapp" && page.whatsapp_business_account) {
        whatsappBusinessId = page.whatsapp_business_account.id;
      }
    }

    // 3. Save (use SYSTEM USER TOKEN)
    await User.findByIdAndUpdate(userId, {
      instagramEnabled: !!instagramBusinessId,
      whatsappEnabled: !!whatsappBusinessId,
      instagramBusinessId,
      whatsappBusinessId,
      instagramToken: process.env.META_SYSTEM_USER_TOKEN,
      whatsappToken: process.env.META_SYSTEM_USER_TOKEN
    });

    return res.json({ success: true });
  } catch (error) {
  console.error(
    "META CONNECT ERROR FULL:",
    error.response?.data || error.message
  );
  return res.status(500).json({
    error: error.response?.data || error.message,
  });
}

});

/* =========================================================
   PASSWORD RESET
========================================================= */
router.post("/forgot-password", async (req, res) => {
  const email = req.body.email.toLowerCase().trim();
  const user = await User.findOne({ email });
  if (!user) return res.sendStatus(200);

  const resetToken = crypto.randomBytes(20).toString("hex");
  user.resetPasswordToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");
  user.resetPasswordExpires = Date.now() + 3600000;
  await user.save();

  const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

  await sendEmail({
    email,
    subject: "MyAutoBot Password Reset",
    html: `<a href="${resetUrl}">Reset Password</a>`
  });

  res.sendStatus(200);
});

router.post("/reset-password/:token", async (req, res) => {
  const hashed = crypto
    .createHash("sha256")
    .update(req.params.token)
    .digest("hex");

  const user = await User.findOne({
    resetPasswordToken: hashed,
    resetPasswordExpires: { $gt: Date.now() }
  });

  if (!user) return res.status(400).json({ message: "Invalid token" });

  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(req.body.password, salt);
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  res.json({ message: "Password updated" });
});

// This MUST be a .get() route
router.get('/webhook/instagram', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // This must match exactly what is in your Meta dashboard image
  const MY_VERIFY_TOKEN = "my_autobot_handshake_ep3us6";

  if (mode === 'subscribe' && token === MY_VERIFY_TOKEN) {
    console.log('✅ Webhook Verified Successfully!');
    // Send ONLY the challenge string back with a 200 status
    return res.status(200).send(challenge);
  } else {
    console.error('❌ Verification Failed: Token Mismatch');
    return res.sendStatus(403);
  }
});


router.post('/webhook/instagram', async (req, res) => {
  const body = req.body;

  if (body.object === 'instagram') {
    for (const entry of body.entry) {
      const pageId = entry.id; // This is the ID of the user's Instagram account
      const messagingEvent = entry.messaging[0];
      console.log("Instagram Messaging Event:", messagingEvent);

      if (messagingEvent.message && !messagingEvent.message.is_echo) {
        // 1. FIND THE USER IN YOUR DATABASE
        const userConfig = await UserSettings.findOne({ instaId: pageId });

        if (userConfig) {
          const incomingText = messagingEvent.message.text;
          const senderId = messagingEvent.sender.id;

          // 2. RUN YOUR LLM LOGIC FOR THIS SPECIFIC USER
          // Use userConfig.accessToken to send the reply back
          await processAiReply(incomingText, senderId, userConfig.accessToken);
        }
      }
      
    }
    res.status(200).send('EVENT_RECEIVED');
  }
});
module.exports = router;
