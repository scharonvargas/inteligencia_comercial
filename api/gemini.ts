import type { VercelRequest, VercelResponse } from '@vercel/node';

const API_KEY = process.env.API_KEY;

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10; // Max 10 requests per minute per IP

// In-memory store for rate limiting (note: resets on cold start)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

function getClientIP(req: VercelRequest): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
        return forwarded.split(',')[0].trim();
    }
    return req.headers['x-real-ip'] as string || 'unknown';
}

function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
    const now = Date.now();
    const record = rateLimitStore.get(ip);

    if (!record || now > record.resetTime) {
        // New window
        rateLimitStore.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
        return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - 1 };
    }

    if (record.count >= MAX_REQUESTS_PER_WINDOW) {
        return { allowed: false, remaining: 0 };
    }

    record.count++;
    return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - record.count };
}

// Clean up old entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of rateLimitStore.entries()) {
        if (now > record.resetTime) {
            rateLimitStore.delete(ip);
        }
    }
}, RATE_LIMIT_WINDOW_MS);

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Rate limiting check
    const clientIP = getClientIP(req);
    const rateCheck = checkRateLimit(clientIP);

    res.setHeader('X-RateLimit-Limit', MAX_REQUESTS_PER_WINDOW.toString());
    res.setHeader('X-RateLimit-Remaining', rateCheck.remaining.toString());

    if (!rateCheck.allowed) {
        return res.status(429).json({
            error: 'Rate limit exceeded. Please wait before making more requests.',
            retryAfter: RATE_LIMIT_WINDOW_MS / 1000
        });
    }

    if (!API_KEY) {
        return res.status(500).json({ error: 'API_KEY não configurada no servidor.' });
    }

    try {
        const { model, contents, config } = req.body;

        if (!model || !contents) {
            return res.status(400).json({ error: 'Parâmetros model e contents são obrigatórios.' });
        }

        // Basic input validation
        if (typeof contents !== 'string' || contents.length > 50000) {
            return res.status(400).json({ error: 'Input inválido ou muito grande.' });
        }

        // Gemini API call
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

        const geminiBody: any = {
            contents: [{ parts: [{ text: contents }] }],
            generationConfig: {
                temperature: config?.temperature || 0.5,
            },
            safetySettings: config?.safetySettings || []
        };

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
