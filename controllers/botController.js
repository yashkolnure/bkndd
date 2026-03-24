const axios = require('axios');
const FormData = require('form-data');

const ENGINE_URL = process.env.ENGINE_URL_BOT;
const API_KEY = process.env.API_KEY_BOT;
const headers = { 'Authorization': `Bearer ${API_KEY}` };

exports.createBot = async (req, res) => {
    try {
        const { name, systemPrompt } = req.body;
        const botId = `bot_${Date.now()}`;

        const payload = {
            id: botId,
            name,
            base_model_id: "llama3.1:8b",
            meta: {
                system: systemPrompt,
                params: { temperature: 0.1, stop: ["User:", "Assistant:"] }
            },
            is_active: true
        };

        const response = await axios.post(`${ENGINE_URL}/models/create`, payload, { headers });
        res.status(201).json(response.data);
    } catch (error) {
        res.status(500).json({ error: "Failed to initialize bot." });
    }
};

exports.addKnowledge = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Upload File
        const form = new FormData();
        form.append('file', req.file.buffer, { filename: req.file.originalname });
        form.append('process', 'true');

        const uploadRes = await axios.post(`${ENGINE_URL}/files/`, form, {
            headers: { ...headers, ...form.getHeaders() }
        });

        // 2. Fetch & Update Model's Knowledge Array
        const bot = await axios.get(`${ENGINE_URL}/models/${id}`, { headers });
        const updatedKnowledge = [...(bot.data.meta.knowledge || []), {
            type: "file",
            id: uploadRes.data.id,
            name: req.file.originalname
        }];

        await axios.post(`${ENGINE_URL}/models/update`, {
            id,
            meta: { ...bot.data.meta, knowledge: updatedKnowledge }
        }, { headers });

        res.json({ success: true, fileId: uploadRes.data.id });
    } catch (error) {
        res.status(500).json({ error: "File processing failed." });
    }
};

exports.updateIdentity = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, systemPrompt } = req.body;

        const bot = await axios.get(`${ENGINE_URL}/models/${id}`, { headers });
        
        await axios.post(`${ENGINE_URL}/models/update`, {
            id,
            name: name || bot.data.name,
            meta: { 
                ...bot.data.meta, 
                system: systemPrompt || bot.data.meta.system 
            }
        }, { headers });

        res.json({ success: true, message: "Persona updated." });
    } catch (error) {
        res.status(500).json({ error: "Update failed." });
    }
};

// ... other controller methods (listBots, deleteBot, removeKnowledge)