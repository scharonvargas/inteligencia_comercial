import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Serverless function to enrich business data with CNPJ information
 * Uses public APIs to fetch company data from Brazilian Federal Registry
 */

const RECEITAWS_BASE = 'https://receitaws.com.br/v1/cnpj';

// Rate limiting for this endpoint
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS = 5; // Limited due to ReceitaWS quotas

function getClientIP(req: VercelRequest): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
    return req.headers['x-real-ip'] as string || 'unknown';
}

function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const record = rateLimitStore.get(ip);

    if (!record || now > record.resetTime) {
        rateLimitStore.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return true;
    }

    if (record.count >= MAX_REQUESTS) return false;
    record.count++;
    return true;
}

// Clean up old entries
setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of rateLimitStore.entries()) {
        if (now > record.resetTime) rateLimitStore.delete(ip);
    }
}, RATE_LIMIT_WINDOW);

export interface CNPJData {
    cnpj: string;
    razaoSocial: string;
    nomeFantasia: string;
    situacao: string;
    dataAbertura: string;
    porte: string;
    capitalSocial: string;
    naturezaJuridica: string;
    atividadePrincipal: string;
    logradouro: string;
    numero: string;
    bairro: string;
    municipio: string;
    uf: string;
    cep: string;
    telefone: string;
    email: string;
    qsa: { nome: string; qual: string }[];
}

function formatCNPJ(cnpj: string): string {
    return cnpj.replace(/[^\d]/g, '');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

    // Rate limit
    const clientIP = getClientIP(req);
    if (!checkRateLimit(clientIP)) {
        return res.status(429).json({ error: 'Rate limit exceeded. Try again in 1 minute.' });
    }

    const { cnpj } = req.query;

    if (!cnpj || typeof cnpj !== 'string') {
        return res.status(400).json({ error: 'CNPJ is required' });
    }

    const cleanCNPJ = formatCNPJ(cnpj);

    if (cleanCNPJ.length !== 14) {
        return res.status(400).json({ error: 'CNPJ must have 14 digits' });
    }

    try {
        // Call ReceitaWS API
        const response = await fetch(`${RECEITAWS_BASE}/${cleanCNPJ}`, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'VeriCorp/1.0'
            }
        });

        if (!response.ok) {
            if (response.status === 429) {
                return res.status(429).json({ error: 'ReceitaWS quota exceeded. Try again later.' });
            }
            return res.status(response.status).json({ error: `ReceitaWS Error: ${response.status}` });
        }

        const data = await response.json();

        if (data.status === 'ERROR') {
            return res.status(404).json({ error: data.message || 'CNPJ not found' });
        }

        // Transform to our format
        const enrichedData: CNPJData = {
            cnpj: data.cnpj || cleanCNPJ,
            razaoSocial: data.nome || '',
            nomeFantasia: data.fantasia || '',
            situacao: data.situacao || '',
            dataAbertura: data.abertura || '',
            porte: data.porte || '',
            capitalSocial: data.capital_social || '',
            naturezaJuridica: data.natureza_juridica || '',
            atividadePrincipal: data.atividade_principal?.[0]?.text || '',
            logradouro: data.logradouro || '',
            numero: data.numero || '',
            bairro: data.bairro || '',
            municipio: data.municipio || '',
            uf: data.uf || '',
            cep: data.cep || '',
            telefone: data.telefone || '',
            email: data.email || '',
            qsa: (data.qsa || []).map((s: any) => ({ nome: s.nome, qual: s.qual }))
        };

        return res.status(200).json(enrichedData);

    } catch (error: any) {
        console.error('CNPJ Enrichment Error:', error);
        return res.status(500).json({ error: error.message || 'Internal server error' });
    }
}
