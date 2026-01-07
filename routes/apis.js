const User = require("../models/User");
const express = require("express");
const router = express.Router();


router.get("/integrations/manual/instagram/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select(
      "instagramBusinessId instagramToken"
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({
      instaId: user.instagramBusinessId || "",
      accessToken: user.instagramToken || ""
    });
  } catch (err) {
    console.error("Fetch IG config error:", err);
    res.status(500).json({ message: "Failed to fetch Instagram config" });
  }
});

// POST /integrations/manual/instagram
router.post("/integrations/manual/instagram", async (req, res) => {
  try {
    const { userId, instaId, accessToken, verifyToken } = req.body;

    if (!userId || !instaId || !accessToken) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      {
        instagramEnabled: true,
        instagramBusinessId: instaId,
        instagramToken: accessToken
        // verifyToken is ONLY for webhook verification, not needed in DB
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({
      success: true,
      user: {
        id: user._id,
        instagramEnabled: user.instagramEnabled,
        instagramBusinessId: user.instagramBusinessId
      }
    });
  } catch (err) {
    console.error("Instagram save error:", err);
    return res.status(500).json({ message: "Failed to save Instagram config" });
  }
});

module.exports = router;
