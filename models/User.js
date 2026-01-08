const mongoose = require("mongoose");
const bcrypt = require("bcryptjs"); // Ensure bcryptjs is installed

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  contact: { type: String }, // Added for your MyAutoBot registration
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
    systemPrompt: { type: String, default: "" }, 
    ragFile: { type: String, default: "" },      
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

// --- MODERN ASYNC MIDDLEWARE ---
// 1. Ensure email is lowercase and hash password before saving
UserSchema.pre("save", async function () {
  // Handle Email
  if (this.email) {
    this.email = this.email.toLowerCase();
  }

  // Handle Password Hashing
  if (!this.isModified("password")) return;

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  } catch (error) {
    throw error; // Mongoose catches this and fails the .save() call safely
  }
});

// 2. Helper method to check password during login
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", UserSchema);