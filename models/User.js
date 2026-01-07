const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  tokens: { type: Number, default: 100 },

  // ---------------- BOT ENGINE CONFIGURATION ----------------
  botConfig: {
    status: { type: String, default: "draft" },
    isManualPromptEnabled: { type: Boolean, default: false },
    isCustomRagEnabled: { type: Boolean, default: false },
    model: {
      primary: { type: String, default: "llama3" },
      fallback: { type: String, default: "llama3.2" }
    },
    customSystemPrompt: { type: String, default: "" },
    systemPrompt: { type: String, default: "" }, // Final compiled prompt
    ragFile: { type: String, default: "" },      // Final compiled RAG content
    rawData: {
      businessName: { type: String, default: "" },
      businessDescription: { type: String, default: "" },
      pricing: { type: String, default: "" },
      faq: { type: String, default: "" },
      policies: { type: String, default: "" },
      agentType: { type: String, default: "support" },
      tone: { type: String, default: "professional" },
      language: { type: String, default: "English" }
    }
  },

  // ---------------- META INTEGRATIONS ----------------
  instagramEnabled: { type: Boolean, default: false },
  instagramBusinessId: { type: String, default: null },
  instagramToken: { type: String, default: null },
  whatsappEnabled: { type: Boolean, default: false },
  whatsappBusinessId: { type: String, default: null },
  whatsappToken: { type: String, default: null },

  // ---------------- PASSWORD RESET ----------------
  resetPasswordToken: String,
  resetPasswordExpires: Date,

  createdAt: { type: Date, default: Date.now }
});

/* Ensure email lowercase */
UserSchema.pre("save", function (next) {
  if (this.email) {
    this.email = this.email.toLowerCase();
  }
  next();
});

module.exports = mongoose.model("User", UserSchema);