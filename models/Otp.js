const mongoose = require('mongoose');

const OtpSchema = new mongoose.Schema({
  email: { 
    type: String, 
    required: true, 
    index: true 
  },
  otpCode: { 
    type: String, 
    required: true 
  },
  name: { type: String },
  password: { type: String },
  contact: { type: String },
  // --- ADD THIS FIELD ---
  refCode: { 
    type: String, 
    default: null 
  },
  // ----------------------
  createdAt: { 
    type: Date, 
    default: Date.now, 
    expires: 300 // Auto-deletes after 5 minutes
  }
});

module.exports = mongoose.model('Otp', OtpSchema);