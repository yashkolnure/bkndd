const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const router = express.Router();

const VERIFY_TOKEN = "ma_wa_handshake_kyifcl";
const APP_SECRET = process.env.META_APP_SECRET;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

// GET – Verification
router.get("/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ WhatsApp webhook verified");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// POST – Incoming messages
router.post(
  "/whatsapp",
  express.json({
    verify: (req, res, buf) => {
      const signature = req.headers["x-hub-signature-256"];
      if (!signature) return;

      const expected = `sha256=${crypto
        .createHmac("sha256", APP_SECRET)
        .update(buf)
        .digest("hex")}`;

      if (signature !== expected) {
        throw new Error("Invalid signature");
      }
    },
  }),
  async (req, res) => {
    try {
      const entry = req.body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;

      if (!value?.messages) return res.sendStatus(200);

      const msg = value.messages[0];
      const from = msg.from;
      const text = msg.text?.body;
      const phoneNumberId = value.metadata.phone_number_id;

      console.log("📩 Incoming:", from, text);

      await axios.post(
        `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
        {
          messaging_product: "whatsapp",
          to: from,
          type: "text",
          text: { body: `Hi 👋 You said: ${text}` },
        },
        {
          headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );

      res.sendStatus(200);
    } catch (err) {
      console.error("Webhook error:", err.message);
      res.sendStatus(500);
    }
  }
);

module.exports = router;
