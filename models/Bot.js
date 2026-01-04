const mongoose = require('mongoose');

const BotSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['active', 'inactive', 'draft'], default: 'draft' },
  model: {
    primary: { type: String, default: 'llama3' },
    fallback: { type: String, default: 'llama3.2' }
  },
  systemPrompt: { type: String },
  generatedPrompt: { type: String },
  customSystemPrompt: { type: String },
  isManualPromptEnabled: { type: Boolean, default: false },
  ragFile: { type: String },
  isCustomRagEnabled: { type: Boolean, default: false },
  customRagContent: { type: String },
  rawData: {
    businessName: { type: String, required: true },
    businessDescription: { type: String },
    pricing: { type: String },
    faq: { type: String },
    policies: { type: String },
    language: { type: String, default: 'English' }
  },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Bot', BotSchema); // Only export the Model