const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true 
  },
  email: { 
    type: String, 
    required: true, 
    unique: true,
    lowercase: true, // Automatically converts to lowercase on save
    trim: true       // Removes accidental whitespace
  },
  tokens: { type: Number, default: 100 },
  password: { 
    type: String, 
    required: true 
  },
  // --- PASSWORD RESET FIELDS ---
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  // -----------------------------
  date: { 
    type: Date, 
    default: Date.now 
  }
});

// Middleware to ensure email is always lowercase before saving
UserSchema.pre('save', function () {
  if (this.email) {
    this.email = this.email.toLowerCase();
  }
});

module.exports = mongoose.model('User', UserSchema);