const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const auth = require('../middleware/auth'); // Ensure you use your JWT middleware

router.get('/', auth, async (req, res) => {
  try {
    // Find leads where 'user' matches the logged-in user's ID
    const leads = await Lead.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json(leads);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = router;