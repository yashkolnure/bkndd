const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const router = express.Router();
const User = require('../models/User');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * ROUTE 1: Create Order
 * Triggered when user clicks "Buy Now" or "Pay"
 */
router.post('/create-order', async (req, res) => {
  try {
    const { amount } = req.body; // Amount in Rupees (e.g., 500)

    const options = {
      amount: amount * 100, // Razorpay expects amount in "paise" (subunits)
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);
    
    // Send the order details to frontend
    res.status(200).json({
      success: true,
      order_id: order.id,
      amount: order.amount,
    });
  } catch (error) {
    console.error("Order Creation Error:", error);
    res.status(500).json({ success: false, message: "Could not create order" });
  }
});

/**
 * ROUTE 2: Verify Payment
 * Triggered by the Razorpay 'handler' callback on the frontend
 */
router.post('/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId, amount } = req.body;

    // 1. Signature Verification (Security Check)
    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest("hex");

    if (razorpay_signature === expectedSignature) {
      // ✅ PAYMENT IS AUTHENTIC
      
      // 2. Calculate tokens ON THE BACKEND (Do not trust frontend count)
      // Mirroring your React logic: 1 Rupee = 10 Tokens
      const baseTokens = amount * 10;
      let bonus = 0;
      if (amount >= 1000) bonus = Math.floor(baseTokens * 0.20);
      else if (amount >= 500) bonus = Math.floor(baseTokens * 0.15);
      else if (amount >= 100) bonus = Math.floor(baseTokens * 0.10);
      
      const totalTokensToCredit = baseTokens + bonus;

      // 3. Atomic Database Update
      // We use $inc to prevent overwriting balance if user has multiple windows open
      const updatedUser = await User.findByIdAndUpdate(
        userId, 
        { $inc: { tokens: totalTokensToCredit } },
        { new: true } // returns the updated document
      );
      console.log(`Credited ${totalTokensToCredit} tokens to User(${userId}). New Balance: ${updatedUser.tokens}`);

      return res.status(200).json({ 
        success: true, 
        message: "Tokens credited successfully!",
        newBalance: updatedUser.tokens 
      });
    } else {
      return res.status(400).json({ success: false, message: "Invalid Signature" });
      console.log("Invalid Signature:", { razorpay_signature, expectedSignature });
    }
  } catch (error) {
    console.error("Verification Error:", error);
    res.status(500).json({ success: false, message: "Server error during verification" });
  }
});

module.exports = router;