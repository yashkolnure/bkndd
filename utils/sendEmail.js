const nodemailer = require('nodemailer');

/**
 * PRODUCTION EMAIL UTILITY
 * Configured for WordPress/cPanel SMTP hosting
 */
const sendEmail = async (options) => {
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST, 
    port: process.env.EMAIL_PORT, 
    secure: process.env.EMAIL_PORT === '465', // true for 465, false for 587
    auth: {
      user: process.env.EMAIL_USER, 
      pass: process.env.EMAIL_PASS, 
    },
    tls: {
      // Prevents connection failure with some hosting providers
      rejectUnauthorized: false 
    }
  });

  const mailOptions = {
    from: `"MyAutoBot AI Security" <${process.env.EMAIL_USER}>`,
    to: options.email,
    subject: options.subject,
    text: options.message,
    html: options.html, // Supports styled dark-mode templates
  };

  await transporter.sendMail(mailOptions);
};

module.exports = sendEmail;