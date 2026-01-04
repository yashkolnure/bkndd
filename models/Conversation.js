const mongoose = require('mongoose');

const ConversationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // The SaaS User (you)
  customerIdentifier: { type: String, default: "Guest User" }, // For now, we'll use this
  messages: [
    {
      role: { type: String, enum: ['user', 'bot'] },
      text: String,
      timestamp: { type: Date, default: Date.now }
    }
  ],
  lastInteraction: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Conversation', ConversationSchema);