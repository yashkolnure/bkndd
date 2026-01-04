const mongoose = require('mongoose');

const LeadSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // The Bot Owner
  contact: { type: String, required: true }, // The extracted Email or Phone
  lastMessage: { type: String }, // The specific message that triggered the lead
  customerIdentifier: { type: String }, // To link the lead back to a specific chat session
  status: { 
    type: String, 
    enum: ['New', 'Contacted', 'Qualified', 'Closed'], 
    default: 'New' 
  },
  notes: { type: String, default: '' }, // For the owner to add manual notes
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Lead', LeadSchema);