const sendEmail = require('../utils/sendEmail');
const User = require('../models/User');
const Lead = require('../models/Lead');

/**
 * --- MYAUTOBOT AI: NEURAL LEAD ENGINE ---
 * Detects, saves, and alerts owner of new lead injections.
 */
const captureLead = async (ownerId, contact, message, name) => {
    try {
        // 1. Avoid duplicates: Check if contact exists for this specific owner
        const existing = await Lead.findOne({ user: ownerId, contact });
        
        if (!existing) {
            const newLead = await Lead.create({
                user: ownerId,
                contact: contact,
                lastMessage: message, 
                customerIdentifier: name || "Anonymous Guest",
                status: 'New',
                createdAt: new Date()
            });

            console.log(`[Neural Engine] New Lead Secured: ${contact}`);

            // 2. Fetch Owner Data for Alert
            const owner = await User.findById(ownerId);
            
            if (owner && owner.email) {
                // 3. Dispatch Branded Email via your sendEmail Utility
                await sendEmail({
                    email: owner.email,
                    subject: `⚡ New Lead Secured: ${newLead.customerIdentifier}`,
                    html: `
                        <div style="background-color: #05010d; color: #ffffff; padding: 40px; font-family: sans-serif; border-radius: 20px; border: 1px solid #1e1b4b;">
                            <h1 style="color: #a855f7; font-style: italic; letter-spacing: -1px;">MYAUTOBOT AI</h1>
                            <p style="color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 2px;">Neural Lead Injection Detected</p>
                            
                            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(168, 85, 247, 0.2); padding: 25px; border-radius: 15px; margin: 25px 0;">
                                <p style="margin: 10px 0;"><strong style="color: #a855f7;">IDENTITY:</strong> ${newLead.customerIdentifier}</p>
                                <p style="margin: 10px 0;"><strong style="color: #a855f7;">CONTACT:</strong> ${newLead.contact}</p>
                                <p style="margin: 10px 0;"><strong style="color: #a855f7;">INQUIRY:</strong> ${newLead.lastMessage}</p>
                            </div>

                            <a href="https://myautobot.in/dashboard" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 25px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 14px;">Open Control Room</a>
                            
                            <p style="margin-top: 30px; font-size: 10px; color: #475569; border-top: 1px solid #1e1b4b; padding-top: 20px;">
                                System Node: SRV-1208 | Encryption: AES-256 Active
                            </p>
                        </div>
                    `
                });
            }
        } else {
            // Update context if user is returning
            existing.lastMessage = message;
            await existing.save();
        }
    } catch (err) {
        console.error("[Neural Engine Error]", err.message);
    }
};

module.exports = captureLead;