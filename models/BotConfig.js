const mongoose = require('mongoose');

const BotConfigSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  status: { type: String, enum: ['active', 'inactive', 'draft'], default: 'draft' },
  
  // Model Architecture
  model: {
    primary: { type: String, default: 'llama3' },
    fallback: { type: String, default: 'llama3.2' }
  },

  // Compiled Data (Sent to LLM)
  systemPrompt: { type: String, default: '' },
  generatedPrompt: { type: String, default: '' }, // Reference for auto-mode
  customSystemPrompt: { type: String, default: '' },
  isManualPromptEnabled: { type: Boolean, default: false },

  // Knowledge Base (RAG)
  ragFile: { type: String, default: '' },
  isCustomRagEnabled: { type: Boolean, default: false },
  
  // Structured UI State (Persists the form fields)
  rawData: {
    businessName: { type: String, required: true },
    businessDescription: { type: String, default: '' },
    pricing: { type: String, default: '' },
    faq: { type: String, default: '' },
    policies: { type: String, default: '' },
    agentType: { type: String, default: 'support' },
    tone: { type: String, default: 'professional' },
    language: { type: String, default: 'English' }
  },

  lastUpdated: { type: Date, default: Date.now }
});

module.exports = mongoose.model('BotConfig', BotConfigSchema);