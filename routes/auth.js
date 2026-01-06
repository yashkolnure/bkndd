const express = require("express");
const router = express.Router();
const axios = require("axios");
const User = require("../models/User");

/* ================= META CONNECT ================= */
router.post("/meta-connect", async (req, res) => {
  const { platform, userId } = req.body;

  console.log("META CONNECT PAYLOAD:", req.body);

  if (!platform || !userId) {
    return res.status(400).json({ message: "Missing params" });
  }

  try {
    const SYSTEM_TOKEN = process.env.META_SYSTEM_USER_TOKEN;
    if (!SYSTEM_TOKEN) throw new Error("System token missing");

    const accountsRes = await axios.get(
      "https://graph.facebook.com/v24.0/me/accounts",
      {
        params: {
          fields: "instagram_business_account,whatsapp_business_account",
          access_token: SYSTEM_TOKEN
        }
      }
    );
    console.log(
  "RAW /me/accounts RESPONSE:",
  JSON.stringify(accountsRes.data, null, 2)
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
    console.error("META CONNECT ERROR:", err.response?.data || err.message);
    return res.status(500).json({ message: "Meta connect failed" });
  }
});

/* ================= WEBHOOK ================= */
router.get("/webhook", (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === process.env.META_VERIFY_TOKEN
  ) {
    return res.send(req.query["hub.challenge"]);
  }
  return res.sendStatus(403);
});

router.post("/webhook", (req, res) => {
  // messages arrive here
  return res.sendStatus(200);
});

module.exports = router;
