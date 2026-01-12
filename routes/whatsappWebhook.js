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
router.post("/whatsapp", express.json(), (req, res) => {
  console.log("🔥 WHATSAPP MESSAGE RECEIVED");
  console.log(JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

module.exports = router;
