const SocialConfig = require('../models/SocialConfig');
const { encrypt } = require('../utils/encryption');

exports.getSettings = async (req, res) => {
    try {
        const config = await SocialConfig.findOne({ userId: req.user.id });
        if (!config) return res.json(null);

        const mask = (str) => (str ? `${str.substring(0, 6)}****************` : "");

        res.json({
            whatsappToken: mask(config.whatsapp.token),
            phoneNumberId: config.whatsapp.phoneNumberId,
            whatsappEnabled: config.whatsapp.enabled,
            instagramToken: mask(config.instagram.token),
            instagramBusinessId: config.instagram.businessId,
            instagramEnabled: config.instagram.enabled,
            verifyToken: config.verifyToken
        });
    } catch (err) {
        res.status(500).json({ message: "Error fetching social links" });
    }
};

exports.updateSettings = async (req, res) => {
    try {
        const { whatsappToken, phoneNumberId, whatsappEnabled, instagramToken, instagramBusinessId, instagramEnabled, verifyToken } = req.body;
        
        const updateData = {
            'whatsapp.phoneNumberId': phoneNumberId,
            'whatsapp.enabled': whatsappEnabled,
            'instagram.businessId': instagramBusinessId,
            'instagram.enabled': instagramEnabled,
            'verifyToken': verifyToken
        };

        if (whatsappToken && !whatsappToken.includes('***')) {
            updateData['whatsapp.token'] = encrypt(whatsappToken);
        }
        if (instagramToken && !instagramToken.includes('***')) {
            updateData['instagram.token'] = encrypt(instagramToken);
        }

        await SocialConfig.findOneAndUpdate(
            { userId: req.user.id },
            { $set: updateData },
            { new: true, upsert: true }
        );

        res.json({ success: true, message: "Social config updated." });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error during sync." });
    }
};