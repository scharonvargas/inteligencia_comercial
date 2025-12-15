import { GoogleGenAI } from "@google/genai";

export const config = {
    runtime: 'edge', // Usa Edge Runtime para performance
};

export default async function handler(req: Request) {
    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    try {
        const { model, contents, config } = await req.json();
        const apiKey = process.env.API_KEY;

        if (!apiKey) {
            return new Response(JSON.stringify({ error: 'Server API Key not configured' }), { status: 500 });
        }

        const ai = new GoogleGenAI({ apiKey });

        const targetModel = model || "gemini-2.5-flash";

        console.log(`[Proxy] Requesting model: ${targetModel}`);

        const response = await ai.models.generateContent({
            model: targetModel,
            contents,
            config
        });

        return new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error: any) {
        console.error("Gemini Proxy Error:", error);
        return new Response(JSON.stringify({
            error: error.message || 'Internal Server Error',
            details: error.toString()
        }), { status: 500 });
    }
}
