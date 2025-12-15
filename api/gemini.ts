import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Multi-Provider AI Proxy with Fallback
 * Primary: Google Gemini
 * Fallback: Groq (free, fast)
 * 
 * Environment Variables:
 *   - API_KEY: Google Gemini API Key
 *   - GROQ_API_KEY: Groq Cloud API Key (free tier available)
 */

interface AIProvider {
    name: string;
    endpoint: string;
    apiKey: string | undefined;
    formatRequest: (model: string, contents: string, config?: any) => any;
    extractResponse: (data: any) => any;
}

const PROVIDERS: AIProvider[] = [
    // PRIMARY: Gemini - stable, reliable
    {
        name: 'Gemini',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={API_KEY}',
        apiKey: process.env.API_KEY,
        formatRequest: (model, contents, config) => ({
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: contents }] }],
                generationConfig: {
                    temperature: config?.temperature ?? 0.5,
                    maxOutputTokens: 8192,
                    responseMimeType: "text/plain"
                },
                safetySettings: config?.safetySettings || [],
                tools: config?.tools || []
            }),
            headers: { "Content-Type": "application/json" }
        }),
        extractResponse: (data) => data
    },
    // FALLBACK: Groq - fast, free tier (30 req/min)
    {
        name: 'Groq',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        apiKey: process.env.GROQ_API_KEY,
        formatRequest: (model, contents, config) => ({
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: contents }],
                temperature: config?.temperature ?? 0.5,
                max_tokens: 8192
            }),
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
            }
        }),
        extractResponse: (data) => ({
            candidates: [{
                content: {
                    parts: [{ text: data.choices?.[0]?.message?.content || '' }]
                }
            }]
        })
    },
    // FALLBACK: Gemini - when Groq unavailable
    {
        name: 'Gemini',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={API_KEY}',
        apiKey: process.env.API_KEY,
        formatRequest: (model, contents, config) => ({
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: contents }] }],
                generationConfig: {
                    temperature: config?.temperature ?? 0.5,
                    maxOutputTokens: 8192,
                    responseMimeType: "text/plain"
                },
                safetySettings: config?.safetySettings || [],
                tools: config?.tools || []
            }),
            headers: { "Content-Type": "application/json" }
        }),
        extractResponse: (data) => data
    }
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { model = "gemini-2.5-flash", contents, config } = req.body;

    if (!contents) {
        return res.status(400).json({ error: "Missing 'contents' in request body" });
    }

    // Track errors for debugging
    const errors: { provider: string; error: string; status?: number }[] = [];

    // Try each provider in order
    for (const provider of PROVIDERS) {
        // Skip providers without API keys
        if (!provider.apiKey) {
            errors.push({ provider: provider.name, error: 'API key not configured' });
            continue;
        }

        try {
            console.log(`[AI Proxy] Trying ${provider.name}...`);

            const endpoint = provider.endpoint
                .replace('{MODEL}', model)
                .replace('{API_KEY}', provider.apiKey);

            const { body, headers } = provider.formatRequest(model, contents, config);

            const response = await fetch(endpoint, {
                method: 'POST',
                headers,
                body
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage = errorData.error?.message || response.statusText;

                errors.push({
                    provider: provider.name,
                    error: errorMessage,
                    status: response.status
                });

                // If 503/429, try next provider
                if (response.status === 503 || response.status === 429) {
                    console.log(`[AI Proxy] ${provider.name} overloaded (${response.status}), trying fallback...`);
                    continue;
                }

                // For other errors, try next provider if available
                const currentIndex = PROVIDERS.indexOf(provider);
                if (currentIndex < PROVIDERS.length - 1) {
                    console.log(`[AI Proxy] ${provider.name} failed (${response.status}), trying fallback...`);
                    continue;
                }

                // Last provider failed, return error
                throw new Error(errorMessage);
            }

            const data = await response.json();
            const normalizedResponse = provider.extractResponse(data);

            console.log(`[AI Proxy] ✅ Success with ${provider.name}`);
            return res.status(200).json(normalizedResponse);

        } catch (error: any) {
            errors.push({
                provider: provider.name,
                error: error.message || 'Unknown error'
            });
            console.error(`[AI Proxy] ${provider.name} failed:`, error.message);
        }
    }

    // All providers failed
    console.error('[AI Proxy] All providers failed:', errors);
    return res.status(503).json({
        error: 'Todos os provedores de IA estão indisponíveis',
        details: errors,
        suggestion: 'Tente novamente em alguns minutos ou reduza o tamanho da busca'
    });
}
