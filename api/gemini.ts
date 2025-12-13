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

        // Recria a chamada para a IA
        const llm = ai.models.get(model || "gemini-2.5-flash"); // Ajuste conforme a SDK nova

        // Na nova SDK @google/genai, a chamada pode variar ligeiramente de generativelanguage,
        // mas baseando no código anterior do usuário que usava:
        // ai.models.generateContent({ model: modelId, contents: prompt, ... })

        // Vamos usar a mesma assinatura que o frontend mandava, mas instanciando aqui
        const response = await ai.models.generateContent({
            model: model || "gemini-2.5-flash",
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
