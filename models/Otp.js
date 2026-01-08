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
  createdAt: { 
    type: Date, 
    default: Date.now, 
    expires: 300 // This entry will auto-delete from MongoDB after 5 minutes
  }
});

module.exports = mongoose.model('Otp', OtpSchema);