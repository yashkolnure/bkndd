const axios = require("axios");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const sendEmail = require("../utils/sendEmail");
const sendReply = require("../utils/sendReply");
const Conversation = require('../models/Conversation');

/* =========================================================
   META OAUTH CALLBACK (JS SDK SAFE, PRODUCTION READY)
========================================================= */
const express = require("express");
const router = express.Router();
router.post("/meta-connect", async (req, res) => {
  console.log("META CONNECT BODY >>>", req.body);

  const { userId, userAccessToken } = req.body;

  /* ---------- 1. VALIDATION ---------- */
  if (!userId) {
    return res.status(400).json({
      message: "Missing userId (login session invalid)"
    });
  }

  if (!userAccessToken) {
    return res.status(400).json({
      message: "Missing Facebook user access token"
    });
  }

  try {
    /* ---------- 2. GET USER PAGES ---------- */
    const pagesRes = await axios.get(
      "https://graph.facebook.com/v19.0/me/accounts",
      {
        params: {
          access_token: userAccessToken
        }
      }
    );

    const pages = pagesRes.data?.data || [];

    if (!pages.length) {
      return res.status(400).json({
        message:
          "No Facebook Pages found. Make sure you are Admin of a Page and Instagram is connected."
      });
    }

    console.log(
      "PAGES FOUND:",
      pages.map(p => ({
        id: p.id,
        name: p.name,
        tokenPrefix: p.access_token?.slice(0, 6)
      }))
    );

    /* ---------- 3. FIND PAGE WITH IG BUSINESS ---------- */
    let finalPage = null;

    for (const page of pages) {
      try {
        const igRes = await axios.get(
          `https://graph.facebook.com/v19.0/${page.id}`,
          {
            params: {
              fields: "instagram_business_account",
              access_token: page.access_token
            }
          }
        );

        if (igRes.data.instagram_business_account) {
          finalPage = {
            pageId: page.id,
            pageToken: page.access_token, // 🔥 EAAG TOKEN
            instagramBusinessId:
              igRes.data.instagram_business_account.id
          };
          break;
        }
      } catch (err) {
        console.warn(
          "IG CHECK FAILED FOR PAGE:",
          page.id,
          err.response?.data || err.message
        );
      }
    }

    if (!finalPage) {
      return res.status(400).json({
        message:
          "No Instagram Business Account connected to your Facebook Pages."
      });
    }

    /* ---------- 4. SAVE TO USER ---------- */
    await User.findByIdAndUpdate(userId, {
      instagramEnabled: true,
      instagramBusinessId: finalPage.instagramBusinessId,
      instagramToken: finalPage.pageToken // 🔑 EAAG ONLY
    });

    console.log(
      "✅ INSTAGRAM CONNECTED",
      "\nIG ID:",
      finalPage.instagramBusinessId,
      "\nTOKEN PREFIX:",
      finalPage.pageToken.slice(0, 6)
    );

    /* ---------- 5. RESPONSE ---------- */
    return res.json({
      success: true,
      instagramBusinessId: finalPage.instagramBusinessId
    });
  } catch (err) {
    console.error(
      "META CONNECT FATAL ERROR:",
      err.response?.data || err.message
    );

    return res.status(500).json({
      message: "Meta connect failed",
      error: err.response?.data || err.message
    });
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
const nodemailer = require('nodemailer');
const Otp = require('../models/Otp'); // Ensure this import exists!

// Configure the transporter
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT),
  secure: true, // Use true for port 465
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  // Hostinger/Titan sometimes requires these extra settings
  tls: {
    rejectUnauthorized: false 
  }
});

router.post("/register", async (req, res) => {
  // Destructure refCode from body; if it doesn't exist, it remains undefined/null
  const { name, password, contact, refCode } = req.body;
  const email = req.body.email.toLowerCase().trim();

  try {
    if (await User.findOne({ email })) {
      return res.status(400).json({ message: "Operator already exists in network." });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Logic remains same, we just include refCode in the object
    await Otp.findOneAndUpdate(
      { email }, 
      { name, password, contact, otpCode, refCode, createdAt: Date.now() }, 
      { upsert: true, new: true }
    );

    const mailOptions = {
      from: `"MyAutoBot Support" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "MyAutoBot Synchronization Code",
      html: `
        <div style="font-family: sans-serif; padding: 20px; background: #0b031a; color: white; border-radius: 10px;">
          <h2 style="color: #a855f7;">Identity Verification</h2>
          <p>Use the code below to initialize your MyAutoBot instance:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #a855f7; margin: 20px 0;">
            ${otpCode}
          </div>
          <p style="font-size: 12px; color: #64748b;">This code expires in 5 minutes.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    res.json({ message: "Verification code dispatched." });
  } catch (error) {
    console.error("DETAILED REGISTER ERROR:", error);
    res.status(500).json({ message: "Internal server error during registration." });
  }
});
// --- Add this to your authRoutes.js ---

router.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  try {
    const record = await Otp.findOne({ email });
    if (!record || record.otpCode !== otp) {
      return res.status(400).json({ message: "Invalid or expired synchronization code." });
    }

    let startingTokens = 500;
    let referralSource = null;
    const BONUS_AMOUNT = 50;

    if (record.refCode) {
      console.log(`🔍 Processing referral protocol for code: ${record.refCode}`);

      // 1. Try finding by the dedicated referralCode field first (STRICT MATCH)
      let inviter = await User.findOne({ referralCode: record.refCode.toUpperCase() });

      // 2. FALLBACK: Match the end of the ID string (LAZY MATCH)
      // We use $expr and $toString to handle the ObjectId type mismatch
      if (!inviter) {
        inviter = await User.findOne({
          $expr: {
            $regexMatch: {
              input: { $toString: "$_id" },
              regex: record.refCode + "$", // Matches the end of the string
              options: "i"
            }
          }
        });
      }

      if (inviter) {
        startingTokens = 550; 
        referralSource = inviter.referralCode || record.refCode.toUpperCase();

        inviter.tokens += BONUS_AMOUNT;
        inviter.referralCount += 1;
        await inviter.save();

        console.log(`✅ SUCCESS: ${inviter.email} awarded +50. New node ${email} starting with 550.`);
      } else {
        console.log(`⚠️ REFERRAL FAILED: No inviter found for code ${record.refCode}`);
      }
    }
    // 3. Create the permanent User Instance
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(record.password, salt);

    const newUser = new User({
      name: record.name,
      email: record.email,
      password: hashedPassword,
      contact: record.contact,
      status: 'active',
      tokens: startingTokens,      // 550 if referred, 500 if not
      referredBy: referralSource
    });

    await newUser.save();
    
    // 4. Cleanup temporary link
    await Otp.deleteOne({ email });

    // 5. Response with JWT
    const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET, { expiresIn: "1d" });

    res.json({
      success: true,
      token,
      user: { 
        id: newUser._id, 
        name: newUser.name, 
        tokens: newUser.tokens 
      }
    });

  } catch (error) {
    console.error("CRITICAL VERIFICATION ERROR:", error);
    res.status(500).json({ message: "Identity verification failed." });
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

// A simple cache to prevent processing the same message twice (Deduplication)
const processedMessages = new Set();

router.post("/webhook/instagram", async (req, res) => {
  const body = req.body;

  // 1. Respond immediately to Meta to stop retries
  res.sendStatus(200);

  if (body.object !== "instagram") return;

  // 2. Process the logic asynchronously (background)
  for (const entry of body.entry || []) {
    const events = entry.messaging || [];

    for (const event of events) {
      const senderId = event.sender?.id;
      const recipientId = event.recipient?.id;
      const messageId = event.message?.mid; // Unique message ID
      const userMessage = event.message?.text;

      // 3. Basic Filters & Deduplication
      if (event.message?.is_echo || !userMessage) continue;
      if (processedMessages.has(messageId)) continue;

      // Add to cache and set cleanup (to prevent memory leaks)
      processedMessages.add(messageId);
      setTimeout(() => processedMessages.delete(messageId), 60000); // Clear after 1 min

      /* ==========================================================
         BACKGROUND PROCESSING
         ========================================================== */
      (async () => {
        try {
          const userDoc = await User.findOne({ instagramBusinessId: recipientId }).lean();
          
          if (!userDoc || !userDoc.instagramToken) {
            return console.log(`❌ IG Webhook: No user/token for ID: ${recipientId}`);
          }

          const userId = userDoc._id.toString();
          const activeToken = userDoc.instagramToken;
          const localApiUrl = `http://localhost:5000/api/chat/public-message/${userId}`;

          // 4. Call Local Chat API
          const chatResponse = await axios.post(localApiUrl, {
            message: userMessage,
            customerData: { name: senderId }
          });

          const botReply = chatResponse.data?.response || "I'm sorry, I couldn't process that.";

          // 5. Send to Instagram (Corrected Object Structure)
          // Note: Axios automatically stringifies objects when Content-Type is application/json
          await axios.post(
            `https://graph.instagram.com/v21.0/me/messages`,
            {
              recipient: { id: senderId },
              message: { text: botReply }
            },
            {
              params: { access_token: activeToken }, // Better to pass token in params
              headers: { "Content-Type": "application/json" }
            }
          );

          console.log(`✅ AI reply sent to ${userDoc.name} for message: ${userMessage}`);

        } catch (err) {
          console.error("🔥 Processing Error:", err.response?.data || err.message);
        }
      })();
    }
  }
});


router.post("/generate-api-key/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // Generate a secure 32-byte key with a prefix
    const buffer = crypto.randomBytes(32);
    const newKey = `ma_${buffer.toString("hex")}`; // "ma_" stands for MyAutoBot

    const user = await User.findByIdAndUpdate(
      userId,
      { apiKey: newKey },
      { new: true }
    );

    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ success: true, apiKey: newKey });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error" });
  }
});

// @route   GET api/user/get-api-key/:userId
router.get("/get-api-key/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select("apiKey");
    if (!user) return res.status(404).json({ message: "User not found" });
    
    res.json({ apiKey: user.apiKey || null });
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

// routes/auth.js
// routes/auth.js

router.patch("/update-referral", async (req, res) => {
  const { userId, referralCode } = req.body;

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Only set the code if it doesn't already exist
    if (!user.referralCode) {
      user.referralCode = referralCode.toUpperCase();
      await user.save();
      console.log(`✅ Locked referral code ${referralCode} for user ${user.email}`);
      return res.json({ success: true, message: "Referral code generated and saved." });
    }

    res.json({ success: true, message: "Code already synchronized." });
  } catch (err) {
    console.error("DB Update Error:", err);
    res.status(500).json({ success: false, message: "Database update failure." });
  }
});

// routes/auth.js

router.get("/validate-ref/:code", async (req, res) => {
  const { code } = req.params;

  try {
    // 1. Try finding by the professional referralCode field
    let inviter = await User.findOne({ referralCode: code.toUpperCase() });

    // 2. If not found, try the "ID Slice" (Lazy Fix)
    if (!inviter) {
      inviter = await User.findOne({ 
        _id: { $regex: new RegExp(code + "$", "i") } 
      });
    }

    if (inviter) {
      return res.json({ valid: true, owner: inviter.name });
    }

    res.json({ valid: false });
  } catch (err) {
    res.status(500).json({ valid: false });
  }
});

// backend/routes/auth.js (or user.js)
router.get("/user-profile/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select("tokens referralCode referralCount"); // Explicitly select these fields

    if (!user) return res.status(404).json({ message: "Operator not found" });

    res.json({
      success: true,
      tokens: user.tokens,
      referralCode: user.referralCode,
      referralCount: user.referralCount
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
