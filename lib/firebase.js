// lib/firebase.js
const admin = require("firebase-admin");
const serviceAccount = require("./petoba-admin-firebase-adminsdk-fbsvc-6339ecc18b.json"); 

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const sendPushNotification = async (fcmTokens, title, body, data = {}) => {
  if (!fcmTokens || (Array.isArray(fcmTokens) && fcmTokens.length === 0)) return;

  // Ensure tokens are in an array format
  const tokens = Array.isArray(fcmTokens) ? fcmTokens : [fcmTokens];

  const message = {
    notification: { title, body },
    data: { ...data, click_action: "FLUTTER_NOTIFICATION_CLICK" }, // Adjust for your Android intent if needed
    tokens: tokens, // sendMulticast is efficient for multiple devices
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`FCM: Successfully sent ${response.successCount} notifications.`);
    
    // Optional: Cleanup expired tokens
    if (response.failureCount > 0) {
      // You could filter tokens that failed with 'messaging/registration-token-not-registered'
    }
  } catch (error) {
    console.error("FCM Error:", error);
  }
};

module.exports = { sendPushNotification };