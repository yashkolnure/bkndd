const express = require("express");
const router = express.Router();
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
router.get("/callback", async (req, res) => {
  const { code, platform, state: userId } = req.query;

  if (!code || !platform || !userId) {
    console.error("META CALLBACK MISSING PARAMS:", req.query);
    console.log("Expected " + { code, platform, userId });
    return res.redirect(
      "https://myautobot.in/dashboard/integrations?status=missing_params"
    );
  }

  try {
    /* -----------------------------------------------------
       1. EXCHANGE CODE → USER ACCESS TOKEN
       IMPORTANT: redirect_uri MUST be empty string
    ----------------------------------------------------- */
    const tokenRes = await axios.post(
      "https://graph.facebook.com/v24.0/oauth/access_token",
      null,
      {
        params: {
          client_id: process.env.META_APP_ID,
          client_secret: process.env.META_APP_SECRET,
          code,
          redirect_uri: "" // REQUIRED FOR JS SDK
        }
      }
    );

    const userAccessToken = tokenRes.data.access_token;

    /* -----------------------------------------------------
       2. DISCOVER ASSETS VIA /me/accounts (TECH PROVIDER)
    ----------------------------------------------------- */
    const accountsRes = await axios.get(
      "https://graph.facebook.com/v24.0/me/accounts",
      {
        params: {
          fields:
            "name,instagram_business_account,whatsapp_business_account",
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

    /* -----------------------------------------------------
       3. USE PRE-GENERATED SYSTEM USER TOKEN (NON-EXPIRING)
       META RECOMMENDED FOR SAAS
    ----------------------------------------------------- */
    const systemUserToken = process.env.META_SYSTEM_USER_TOKEN;

    if (!systemUserToken) {
      throw new Error("META_SYSTEM_USER_TOKEN missing");
    }

    /* -----------------------------------------------------
       4. SAVE TO USER PROFILE
    ----------------------------------------------------- */
    await User.findByIdAndUpdate(userId, {
      instagramEnabled: !!instagramBusinessId,
      whatsappEnabled: !!whatsappBusinessId,
      instagramBusinessId,
      whatsappBusinessId,
      instagramToken: systemUserToken,
      whatsappToken: systemUserToken
    });

    return res.redirect(
      "https://myautobot.in/dashboard/integrations?status=success"
    );
  } catch (error) {
    console.error(
      "META CALLBACK ERROR:",
      error.response?.data || error.message
    );

    return res.redirect(
      "https://myautobot.in/dashboard/integrations?status=error"
    );
  }
});

/* =========================================================
   META WEBHOOK VERIFICATION
========================================================= */
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    console.log("META WEBHOOK VERIFIED");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

/* =========================================================
   META WEBHOOK RECEIVER (INSTAGRAM + WHATSAPP)
========================================================= */
router.post("/webhook", async (req, res) => {
  const body = req.body;

  if (
    body.object !== "instagram" &&
    body.object !== "whatsapp_business_account"
  ) {
    return res.sendStatus(404);
  }

  try {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0]?.value;
    const messaging = entry?.messaging?.[0];

    const senderId =
      messaging?.sender?.id ||
      changes?.messages?.[0]?.from;

    const messageText =
      messaging?.message?.text ||
      changes?.messages?.[0]?.text?.body;

    const recipientId = entry?.id;

    if (!senderId || !messageText || !recipientId) {
      return res.sendStatus(200);
    }

    /* -----------------------------------------------------
       FIND BOT OWNER
    ----------------------------------------------------- */
    const botOwner = await User.findOne({
      $or: [
        { instagramBusinessId: recipientId },
        { whatsappBusinessId: recipientId }
      ]
    });

    if (!botOwner || botOwner.tokens < 5) {
      return res.sendStatus(200);
    }

    /* -----------------------------------------------------
       SEND TO LOCAL LLM (OLLAMA)
    ----------------------------------------------------- */
    const aiRes = await axios.post(
      process.env.OLLAMA_URL || "http://127.0.0.1:11434/api/generate",
      {
        model: "llama3.2",
        prompt: `User: ${messageText}`,
        stream: false
      }
    );

    const reply = aiRes.data.response;

    /* -----------------------------------------------------
       DEDUCT TOKENS
    ----------------------------------------------------- */
    await User.findByIdAndUpdate(botOwner._id, {
      $inc: { tokens: -5 }
    });

    /* -----------------------------------------------------
       SEND MESSAGE BACK TO META
    ----------------------------------------------------- */
    await sendReply(
      senderId,
      reply,
      botOwner.whatsappToken || botOwner.instagramToken
    );

    return res.sendStatus(200);
  } catch (err) {
    console.error("WEBHOOK PROCESS ERROR:", err.message);
    return res.sendStatus(200);
  }
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
router.post("/login", async (req, res) => {
  // 1. Sanitize input
  const email = req.body.email?.toLowerCase().trim();
  const { password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    // 2. Locate user
    const user = await User.findOne({ email });
    if (!user) {
      // Use 401 for authentication issues
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // 3. Verify password
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // 4. Generate Neural Access Token
    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    // 5. Send optimized response
    res.json({
      token,
      user: { 
        id: user._id, 
        name: user.name,
        email: user.email // Helpful to have in frontend state
      }
    });

  } catch (error) {
    // Log the actual error for the developer, but hide details from the user
    console.error("Critical Login Error:", error);
    res.status(500).json({ message: "Internal server error. Please try again later." });
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

module.exports = router;
