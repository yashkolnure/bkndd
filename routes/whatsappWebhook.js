const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const router = express.Router();

const VERIFY_TOKEN = "ma_wa_handshake_kyifcljsxujudsjnxavenirya2026";
const APP_SECRET = process.env.META_APP_SECRET;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

// GET – Verification
let messagesDb = []; // Temporary storage for demo purposes

router.post("/whatsapp", (req, res) => {
  const body = req.body;

  if (body.object === "whatsapp_business_account") {
    const entry = body.entry?.[0];
    const message = entry?.changes?.[0]?.value?.messages?.[0];

    if (message) {
      const newMessage = {
        id: message.id,
        from: message.from,
        text: message.text.body,
        timestamp: new Date(),
        type: "incoming"
      };
      messagesDb.push(newMessage);
      
      // OPTIONAL: If you want real-time updates in React, 
      // you would trigger a Socket.io event here.
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// GET Route for React to fetch the message history
router.get("/messages", (req, res) => {
  res.json(messagesDb);
});


module.exports = router;
