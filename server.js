const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

/* ---------- Middleware ---------- */
app.use(express.json());
app.use(cors({
  origin: true,
  credentials: true
}));

/* ---------- Health Check ---------- */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

/* ---------- MongoDB ---------- */
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.error("Mongo Error:", err));

/* ---------- Routes ---------- */
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/apis'));
app.use('/api/bot', require('./routes/bot'));
app.use('/api/botRoutes', require('./routes/botRoutes'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/payments', require('./routes/paymentRoutes'));
app.use('/api/auth/webhook', require('./routes/whatsappWebhook'));

/* ---------- Server ---------- */
const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`Server running on http://127.0.0.1:${PORT}`);
});

/* ---------- Graceful shutdown ---------- */
process.on('SIGTERM', () => {
  console.log('SIGTERM received');
  server.close(() => process.exit(0));
});
