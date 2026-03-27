// lib/firebase.js
const admin = require("firebase-admin");
const serviceAccount = require("./petoba-admin-firebase-adminsdk-fbsvc-6339ecc18b.json"); 

// Check if already initialized to prevent errors during hot-reloads
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
}

/**
 * Sends a high-priority push notification to a single FCM token.
 */
const sendPushNotification = async (fcmToken, title, body, data = {}) => {
  // 1. Validation
  if (!fcmToken || typeof fcmToken !== 'string') {
    console.log("FCM: No valid token provided, skipping.");
    return;
  }

  // 2. Build the Message Payload
  const message = {
    notification: { 
      title: title, 
      body: body 
    },
    // Data must contain only strings
    data: data, 
    token: fcmToken,
    
    // --- Priority Settings ---
    android: {
      priority: 'high', // Delivers immediately even in Doze mode
      notification: {
        sound: 'default',
        channelId: 'my_autobot_messages', // Must match your Android NotificationChannel ID
        priority: 'high',
        clickAction: 'FLUTTER_NOTIFICATION_CLICK' // Keep for compatibility
      }
    },
    apns: {
      headers: {
        'apns-priority': '10', // 10 is high priority for Apple
      },
      payload: {
        aps: {
          sound: 'default',
          badge: 1
        },
      },
    },
  };

  console.log(`Sending High-Priority FCM to: ${fcmToken.substring(0, 10)}...`);

  try {
    // Use .send() for a single token
    const response = await admin.messaging().send(message);
    console.log("FCM: Successfully sent notification. ID:", response);
    return response;
  } catch (error) {
    console.error("FCM Error:", error);
    
    // If token is invalid or expired, handle accordingly
    if (error.code === 'messaging/registration-token-not-registered') {
      console.warn("FCM: Token is no longer valid. Consider clearing it from the User record.");
    }
    throw error;
  }
};

module.exports = { sendPushNotification };