const mongoose = require('mongoose');

const SocialConfigSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true, 
    unique: true 
  },
  whatsapp: {
    token: { type: String }, // Encrypted
    phoneNumberId: { type: String },
    enabled: { type: Boolean, default: false }
  },
  instagram: {
    token: { type: String }, // Encrypted
    businessId: { type: String },
    enabled: { type: Boolean, default: false }
  },
  verifyToken: { 
    type: String, 
    default: 'my_handshake_secret' 
  },
}, { timestamps: true });

module.exports = mongoose.model('SocialConfig', SocialConfigSchema);