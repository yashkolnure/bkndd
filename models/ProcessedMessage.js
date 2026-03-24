const mongoose = require("mongoose");

const processedMessageSchema = new mongoose.Schema({
  messageId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  customerNumber: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 60 * 60 * 24 * 7 // auto delete after 7 days
  }
});

module.exports = mongoose.model("ProcessedMessage", processedMessageSchema);