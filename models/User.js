const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  // ---------------- BASIC ----------------
  name: { 
    type: String, 
    required: true 
  },

  email: { 
    type: String, 
    required: true, 
    unique: true,
    lowercase: true,
    trim: true
  },

  password: { 
    type: String, 
    required: true 
  },

  tokens: { 
    type: Number, 
    default: 100 
  },

  // ---------------- META INTEGRATIONS ----------------

  instagramEnabled: {
    type: Boolean,
    default: false
  },

  instagramBusinessId: {
    type: String,
    default: null
  },

  instagramToken: {
    type: String,
    default: null
  },

  whatsappEnabled: {
    type: Boolean,
    default: false
  },

  whatsappBusinessId: {
    type: String,
    default: null
  },

  whatsappToken: {
    type: String,
    default: null
  },

  // ---------------- PASSWORD RESET ----------------
  resetPasswordToken: String,
  resetPasswordExpires: Date,

  // ---------------- META DATA ----------------
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

/* Ensure email lowercase */
UserSchema.pre("save", function () {
  if (this.email) {
    this.email = this.email.toLowerCase();
  }
});

module.exports = mongoose.model("User", UserSchema);
