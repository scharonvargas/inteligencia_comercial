import type { VercelRequest, VercelResponse } from '@vercel/node';

// Environment Keys
const GEMINI_API_KEY = process.env.API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 20;
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
        rateLimitStore.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
        return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - 1 };
    }
    if (record.count >= MAX_REQUESTS_PER_WINDOW) {
        return { allowed: false, remaining: 0 };
    }
    record.count++;
    return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - record.count };
}

// --- ADAPTERS ---

async function callDeepSeek(contents: string, systemInstruction: string, temperature: number) {
    if (!DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY not configured");

    const messages = [
        { role: "system", content: systemInstruction },
        { role: "user", content: contents }
    ];

    const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "deepseek-chat",
            messages: messages,
            temperature: temperature,
            response_format: { type: "json_object" }
        })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`DeepSeek API Error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

async function callGroq(model: string, contents: string, systemInstruction: string, temperature: number) {
    if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY not configured");

    const groqModel = "llama-3.3-70b-versatile";

    const messages = [
        { role: "system", content: systemInstruction },
        { role: "user", content: contents }
    ];

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${GROQ_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: groqModel,
            messages: messages,
            temperature: temperature,
            response_format: { type: "json_object" }
        })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Groq API Error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

async function callGemini(model: string, contents: string, systemInstruction: string, config: any) {
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

    const geminiBody: any = {
        contents: [{ parts: [{ text: contents }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
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
        throw new Error(`Gemini API Error ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// --- HANDLER ---

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS Setup
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    // Rate Limit Check
    const clientIP = getClientIP(req);
    const rateCheck = checkRateLimit(clientIP);
    res.setHeader('X-RateLimit-Limit', MAX_REQUESTS_PER_WINDOW.toString());
    res.setHeader('X-RateLimit-Remaining', rateCheck.remaining.toString());

    if (!rateCheck.allowed) {
        return res.status(429).json({ error: 'Rate limit exceeded.' });
    }

    try {
        const { model, contents, config } = req.body;
        const systemInstruction = "Você é uma API REST JSON estrita. Você converte intenções de busca em dados estruturados. PROIBIDO: Gerar código (Python, JS, etc), explicações ou texto conversacional. OBRIGATÓRIO: Responder apenas com um array JSON válido de objetos BusinessEntity.";

        let textResponse = "";
        let provider = "";

        // PRIORITY: DEEPSEEK -> GROQ -> GEMINI
        try {
            if (DEEPSEEK_API_KEY) {
                console.log("Attempting DEEPSEEK provider...");
                textResponse = await callDeepSeek(contents, systemInstruction, config?.temperature || 0.5);
                provider = "DEEPSEEK-V3";
            } else {
                throw new Error("No DEEPSEEK Key");
            }
        } catch (deepSeekError) {
            console.warn("DeepSeek failed, trying Groq:", deepSeekError);
            try {
                if (GROQ_API_KEY) {
                    console.log("Attempting GROQ provider...");
                    textResponse = await callGroq(model, contents, systemInstruction, config?.temperature || 0.5);
                    provider = "GROQ-LLAMA3";
                } else {
                    throw new Error("No GROQ Key");
                }
            } catch (groqError) {
                console.warn("Groq failed, falling back to Gemini:", groqError);
                // Fallback to Gemini
                textResponse = await callGemini(model, contents, systemInstruction, config);
                provider = "GEMINI-FLASH";
            }
        }

        return res.status(200).json({
            text: textResponse,
            provider: provider,
            candidates: [{ content: { parts: [{ text: textResponse }] } }]
        });

    } catch (error: any) {
        console.error('Proxy Fatal Error:', error);
        return res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
}
