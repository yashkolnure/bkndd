const jwt = require('jsonwebtoken');

/**
 * MYAUTOBOT AUTH MIDDLEWARE
 * Extracts JWT from Bearer token and attaches user payload to req object.
 */
module.exports = function (req, res, next) {
  // 1. Get token from the Authorization header (Format: "Bearer <token>")
  const authHeader = req.header('Authorization');
  const token = authHeader && authHeader.split(' ')[1];

  // 2. Check if token exists
  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Uplink Denied: No authentication token found.' 
    });
  }

  try {
    // 3. Verify the token using your JWT_SECRET from .env
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 4. Attach decoded payload (usually { id: "..." }) to the request
    // This allows router.get('/config') to access req.user.id
    req.user = decoded; 

    next(); // Move to the next function in the route
  } catch (err) {
    console.error("Token verification failed:", err.message);
    res.status(401).json({ 
      success: false, 
      message: 'Neural Link Expired: Please login again.' 
    });
  }
};