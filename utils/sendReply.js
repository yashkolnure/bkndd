const axios = require("axios");

/**
 * Send message reply to WhatsApp or Instagram
 * @param {string} recipientId - User ID (WhatsApp phone or IG user ID)
 * @param {string} message - Text to send
 * @param {string} token - System User Access Token
 */
module.exports = async function sendReply(recipientId, message, token) {
  try {
    /* ---------------------------------------------
       WHATSAPP CLOUD API (Phone number IDs are numeric)
    --------------------------------------------- */
    if (/^\d+$/.test(recipientId)) {
      // WhatsApp Cloud API
      await axios.post(
        `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: recipientId,
          text: { body: message }
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          }
        }
      );

      return;
    }

    /* ---------------------------------------------
       INSTAGRAM DM API
    --------------------------------------------- */
    await axios.post(
      `https://graph.facebook.com/v19.0/me/messages`,
      {
        recipient: { id: recipientId },
        message: { text: message }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (error) {
    console.error(
      "SEND REPLY ERROR:",
      error.response?.data || error.message
    );
  }
};
