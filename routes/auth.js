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


router.post("/webhook/instagram", async (req, res) => {
  try {
    const body = req.body;
    const CHAT_COST = 5; //

    if (body.object !== "instagram") return res.sendStatus(200);

    for (const entry of body.entry || []) {
      const events = entry.messaging || [];

      for (const event of events) {
        // 1. Basic Filters
        if (event.message?.is_echo || !event.message?.text) continue;

        const senderId = event.sender?.id;
        const recipientId = event.recipient?.id; // This is your Instagram Business ID
        const userMessage = event.message.text;

        /* ==========================================================
           2. RESOLVE USER & DEDUCT TOKENS
           Find the owner by Instagram ID and ensure they are active.
           ========================================================== */
        const user = await User.findOneAndUpdate(
          { 
            instagramBusinessId: recipientId, 
            "botConfig.status": "active", 
            tokens: { $gte: CHAT_COST } 
          },
          { $inc: { tokens: -CHAT_COST } },
          { new: true }
        ).lean(); //

        if (!user) {
          console.log("❌ IG BLOCK: User not found, inactive, or out of tokens.");
          continue;
        }

        /* ==========================================================
           3. RETRIEVE MEMORY & COMPILE PROMPTS
           ========================================================== */
        const historyDoc = await Conversation.findOne({ 
          user: user._id, 
          customerIdentifier: senderId 
        }).lean(); //

        const pastMessages = historyDoc ? historyDoc.messages.slice(-6).map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.text
        })) : []; //

        const systemContent = `${user.botConfig.systemPrompt}\n\n[KNOWLEDGE_BASE]\n${user.botConfig.ragFile}`.trim(); //

        /* ==========================================================
           4. VPS AI CALL
           ========================================================== */
        const vpsPayload = {
          model: user.botConfig.model?.primary || "llama3",
          messages: [
            { role: "system", content: systemContent },
            ...pastMessages,
            { role: "user", content: userMessage }
          ],
          options: { temperature: 0.2 }
        }; //

        const aiResponse = await axios.post(
          `${process.env.VPS_AI_URL}/api/chat`, 
          vpsPayload
        );
        const botReply = aiResponse.data?.message?.content || "I'm having trouble thinking right now.";

        /* ==========================================================
           5. SEND REPLY TO INSTAGRAM
           ========================================================== */
        await axios.post(
          "https://graph.instagram.com/v21.0/me/messages",
          {
            message: JSON.stringify({ text: botReply }),
            recipient: JSON.stringify({ id: senderId })
          },
          {
            headers: {
              Authorization: `Bearer ${user.instagramToken}`, // Use user's specific token
              "Content-Type": "application/json"
            }
          }
        );

        /* ==========================================================
           6. LOG CONVERSATION
           ========================================================== */
        await Conversation.findOneAndUpdate(
          { user: user._id, customerIdentifier: senderId },
          {
            $push: {
              messages: [
                { role: 'user', text: userMessage, timestamp: new Date() },
                { role: 'bot', text: botReply, timestamp: new Date() }
              ]
            },
            $set: { lastInteraction: new Date() }
          },
          { upsert: true }
        ); //

        console.log(`✅ AI Response sent to IG: ${senderId} | Tokens: ${user.tokens}`);
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("🔥 IG Webhook Error:", err.response?.data || err.message);
    return res.sendStatus(200);
  }
});

module.exports = router;
