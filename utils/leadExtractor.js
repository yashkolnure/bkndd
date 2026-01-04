const Lead = require('../models/Lead');

const captureLead = async (botId, message, customerId) => {
  // Regex for international phone numbers and standard emails
  const phoneRegex = /(\+?\d{1,4}[\s-]?)?(\(?\d{3}\)?[\s-]?)?[\d\s-]{7,15}/g;
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  const foundPhone = message.match(phoneRegex);
  const foundEmail = message.match(emailRegex);

  // Prioritize phone, then email
  const contactInfo = foundPhone ? foundPhone[0].trim() : (foundEmail ? foundEmail[0].trim() : null);

  if (contactInfo) {
    try {
      // Check if this contact already exists for this bot to avoid duplicates
      const existingLead = await Lead.findOne({ user: botId, contact: contactInfo });
      
      if (!existingLead) {
        const newLead = await Lead.create({
          user: botId,
          contact: contactInfo,
          lastMessage: message,
          customerIdentifier: customerId
        });
        console.log(`New Lead Captured: ${contactInfo}`);
        return newLead;
      }
    } catch (err) {
      console.error("Lead Capture Error:", err);
    }
  }
  return null;
};

module.exports = captureLead;