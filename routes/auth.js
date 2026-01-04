const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); 
const sendEmail = require('../utils/sendEmail');
const User = require('../models/User');
const axios = require('axios');


// This handles: GET myautobot.in/api/auth/callback
router.get('/callback', async (req, res) => {
    const { code } = req.query; // The temporary code from Meta

    if (!code) {
        return res.status(400).json({ error: "No authorization code received" });
    }

    try {
    // 1. Exchange 'code' for Short-Lived Token (Your current step)
    const tokenRes = await axios.get(`https://graph.facebook.com/v18.0/oauth/access_token`, {
        params: {
            client_id: process.env.META_APP_ID,
            client_secret: process.env.META_APP_SECRET,
            redirect_uri: 'https://myautobot.in/api/auth/callback',
            code
        }
    });
    const shortToken = tokenRes.data.access_token;

    // 2. UPGRADE to Long-Lived Token (60 Days)
    // This ensures your bot doesn't stop working after 2 hours!
    const longLivedRes = await axios.get(`https://graph.facebook.com/v18.0/oauth/access_token`, {
        params: {
            grant_type: 'fb_exchange_token',
            client_id: process.env.META_APP_ID,
            client_secret: process.env.META_APP_SECRET,
            fb_exchange_token: shortToken
        }
    });
    const finalToken = longLivedRes.data.access_token;

    // 3. AUTOMATIC ACCOUNT DISCOVERY
    // Fetch Facebook Pages + Linked Instagram Accounts
    const accountsRes = await axios.get(`https://graph.facebook.com/v18.0/me/accounts`, {
        params: { 
            fields: 'instagram_business_account,access_token,name',
            access_token: finalToken 
        }
    });

    // Fetch WhatsApp Business Accounts
    const waRes = await axios.get(`https://graph.facebook.com/v18.0/me/whatsapp_business_accounts`, {
        params: { access_token: finalToken }
    });

    // 4. PICK THE FIRST ACTIVE ACCOUNTS
    const igAccount = accountsRes.data.data.find(page => page.instagram_business_account);
    const waAccount = waRes.data.data[0]; // Gets the first WhatsApp Business Account

    // 5. UPDATE DATABASE
    // We link these IDs to the user so your Webhook knows who is who
    await User.findByIdAndUpdate(req.user.id, {
        instagramToken: igAccount?.access_token, // Page-specific token for replies
        instagramBusinessId: igAccount?.instagram_business_account?.id,
        whatsappBusinessId: waAccount?.id,
        instagramEnabled: !!igAccount,
        whatsappEnabled: !!waAccount
    });

    res.redirect('https://myautobot.in/dashboard/integrations?status=success');

} catch (error) {
    console.error("Meta Discovery Error:", error.response?.data || error.message);
    res.redirect('https://myautobot.in/dashboard/integrations?status=error');
}
});
// --- 1. REGISTER ---
router.post('/register', async (req, res) => {
  // Normalize email to lowercase
  const { name, password } = req.body;
  const email = req.body.email.toLowerCase().trim();

  try {
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ message: "Node already exists in network" });

    user = new User({ name, email, password });
    
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user: { id: user._id, name: user.name } });
  } catch (err) {
    res.status(500).send("Registration Error");
  }
});

// --- 2. LOGIN ---
router.post('/login', async (req, res) => {
  // Normalize email to lowercase
  const { password } = req.body;
  const email = req.body.email.toLowerCase().trim();

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Invalid Credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid Credentials" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user: { id: user._id, name: user.name } });
  } catch (err) {
    res.status(500).send("Login Error");
  }
});


router.post('/forgot-password', async (req, res) => {
  const email = req.body.email.toLowerCase().trim();

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "Identity node not found." });

    // 1. Generate Plain Token for URL
    const resetToken = crypto.randomBytes(20).toString('hex');

    // 2. Save SHA-256 Hashed Token to Database for Security
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpires = Date.now() + 3600000; // 1 Hour Expiry

    await user.save();

    // 3. Construct Reset URL (Points to your new ResetPassword.jsx page)
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

    // 4. Industrial MyAutoBot HTML Template
    const htmlContent = `
      <div style="background-color: #05010d; color: #ffffff; padding: 50px; font-family: 'Segoe UI', Tahoma, sans-serif; border-radius: 24px; text-align: center;">
        <h2 style="color: #a855f7; text-transform: uppercase; letter-spacing: 4px; font-style: italic;">Access Key Reset</h2>
        <p style="color: #64748b; font-size: 14px; margin-bottom: 30px;">A security bypass was requested for your MyAutoBot node.</p>
        <div style="margin: 40px 0;">
          <a href="${resetUrl}" style="background-color: #9333ea; color: #ffffff; padding: 18px 32px; text-decoration: none; border-radius: 12px; font-weight: 900; text-transform: uppercase; font-size: 12px; letter-spacing: 2px; box-shadow: 0 10px 20px -5px rgba(147, 51, 234, 0.5);">
            Authorize Recalibration
          </a>
        </div>
        <p style="font-size: 10px; color: #334155; text-transform: uppercase; letter-spacing: 1px;">
          Link expires in 60 minutes. If you did not initiate this, secure your node immediately.
        </p>
        <p style="font-size: 9px; color: #1e293b; margin-top: 20px; text-transform: uppercase;">System: MyAutoBot Core</p>
      </div>
    `;

    // 5. Dispatch Email via your WordPress SMTP
    await sendEmail({
      email: user.email,
      subject: 'MyAutoBot Security: Password Reset Protocol',
      html: htmlContent
    });

    res.json({ message: "Security link dispatched to your inbox." });
  } catch (err) {
    console.error("Mailer Error:", err);
    res.status(500).json({ message: "Neural dispatch failed. Check SMTP config." });
  }
});
// --- 4. RESET PASSWORD ---
router.post('/reset-password/:token', async (req, res) => {
  // Hash the token from the URL to compare with the DB version
  const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

  try {
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() } // Must not be expired
    });

    if (!user) return res.status(400).json({ message: "Token is invalid or has expired" });

    // Set & Hash new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(req.body.password, salt);

    // Clear reset credentials
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();

    res.json({ message: "Credentials recalibrated successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to update node security" });
  }
});

// --- GET ALL USERS (Admin Only) ---
router.get('/admin/users', async (req, res) => {
  try {
    // Select name, email, contact, and createdAt (excluding password)
    const users = await User.find({}).select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch node network data." });
  }
});

// --- DELETE USER ---
router.delete('/admin/user/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "Node successfully decommissioned." });
  } catch (err) {
    res.status(500).json({ message: "Error removing node." });
  }
});

module.exports = router;