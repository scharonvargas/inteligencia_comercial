import type { VercelRequest, VercelResponse } from '@vercel/node';

const API_KEY = process.env.API_KEY;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Permitir apenas POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!API_KEY) {
        return res.status(500).json({ error: 'API_KEY não configurada no servidor.' });
    }

    try {
        const { model, contents, config } = req.body;

        if (!model || !contents) {
            return res.status(400).json({ error: 'Parâmetros model e contents são obrigatórios.' });
        }

        // Chamada à API do Gemini
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

        const geminiBody: any = {
            contents: [{ parts: [{ text: contents }] }],
            generationConfig: {
                temperature: config?.temperature || 0.5,
            },
            safetySettings: config?.safetySettings || []
        };

        // Adicionar tools se especificado (ex: googleSearch)
        if (config?.tools) {
            geminiBody.tools = config.tools;
        }

        const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Gemini API Error:', errorText);
            return res.status(response.status).json({ error: `Gemini API Error: ${response.status}` });
        }

        const data = await response.json();

        // Extrair texto da resposta
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

        return res.status(200).json({
            text,
            candidates: data.candidates
        });

    } catch (error: any) {
        console.error('Proxy Error:', error);
        return res.status(500).json({ error: error.message || 'Erro interno do servidor.' });
    }
}
