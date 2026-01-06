const axios = require("axios");

module.exports = async function sendReply({
  igBusinessId,
  pageToken,
  recipientId,
  text
}) {
  try {
    const res = await axios.post(
      `https://graph.facebook.com/v19.0/${igBusinessId}/messages`,
      {
        recipient: { id: recipientId },
        message: { text }
      },
      {
        params: { access_token: pageToken }
      }
    );

    console.log("📤 IG reply success:", res.data);
  } catch (err) {
    console.error(
      "❌ IG reply failed:",
      err.response?.data || err.message
    );
  }
};
