const User = require("../models/User");

const apiAuth = async (req, res, next) => {
  const userKey = req.headers["x-api-key"];

  if (!userKey) {
    return res.status(401).json({ message: "No API Key provided." });
  }

  try {
    const user = await User.findOne({ apiKey: userKey });

    if (!user) {
      return res.status(401).json({ message: "Invalid API Key." });
    }

    if (user.tokens < 5) {
      return res.status(402).json({ message: "Insufficient tokens (Need 5)." });
    }

    // Attach user to request for use in the route
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ message: "Auth Error" });
  }
};

module.exports = apiAuth;