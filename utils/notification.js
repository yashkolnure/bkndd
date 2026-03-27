// utils/notification.js
const admin = require('firebase-admin');
const serviceAccount = require('./petoba-admin-firebase-adminsdk-fbsvc-6339ecc18b.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const sendPushNotification = async (fcmToken, title, body, data = {}) => {
  const message = {
    notification: { title, body },
    data: data, // Optional: add extra data like messageId or chatId
    token: fcmToken
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('Successfully sent message:', response);
    return response;
  } catch (error) {
    console.error('Error sending message:', error);
    // If error is 'messaging/registration-token-not-registered', 
    // you might want to clear the token from the DB.
  }
};

module.exports = sendPushNotification;