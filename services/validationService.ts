/**
 * Serviço de Validação de Leads
 * Usa múltiplas fontes:
 * - Google Places API (New) para validação de existência
 * - BrasilAPI para CNPJ
 * - Nominatim para endereço
 * - Validação local para telefone
 */

import { validateBusiness } from './placesService';

export interface ValidationResult {
    isValid: boolean;
    confidence: number; // 0-100
    data?: any;
    error?: string;
}

export interface LeadValidation {
    cnpjValid?: boolean;
    phoneValid?: boolean;
    addressValid?: boolean;
    googleValid?: boolean; // Validação via Google Places
    overallStatus: 'pending' | 'verified' | 'partial' | 'failed';
    lastValidated: string;
    details?: {
        cnpjData?: any;
        addressData?: any;
        googleData?: {
            rating?: number;
            reviewCount?: number;
            phone?: string;
            website?: string;
            isOpen?: boolean;
        };
    };
}

// Rate limiting para BrasilAPI (3 req/s max)
let lastBrasilAPICall = 0;
const BRASIL_API_COOLDOWN = 350; // ms

async function rateLimitedFetch(url: string): Promise<Response> {
    const now = Date.now();
    const timeSinceLastCall = now - lastBrasilAPICall;

    if (timeSinceLastCall < BRASIL_API_COOLDOWN) {
        await new Promise(resolve => setTimeout(resolve, BRASIL_API_COOLDOWN - timeSinceLastCall));
    }

    lastBrasilAPICall = Date.now();
    return fetch(url);
}

/**
 * Valida CNPJ usando BrasilAPI (gratuito)
 */
export async function validateCNPJ(cnpj: string): Promise<ValidationResult> {
    const cleanCNPJ = cnpj.replace(/[^\d]/g, '');

    if (cleanCNPJ.length !== 14) {
        return { isValid: false, confidence: 0, error: 'CNPJ deve ter 14 dígitos' };
    }

    try {
        const response = await rateLimitedFetch(`https://brasilapi.com.br/api/cnpj/v1/${cleanCNPJ}`);

        if (!response.ok) {
            if (response.status === 404) {
                return { isValid: false, confidence: 100, error: 'CNPJ não encontrado na base da Receita' };
            }
            return { isValid: false, confidence: 50, error: `Erro na API: ${response.status}` };
        }

        const data = await response.json();
        const isActive = data.descricao_situacao_cadastral?.toLowerCase() === 'ativa';

        return {
            isValid: isActive,
            confidence: 95,
            data: {
                razaoSocial: data.razao_social,
                nomeFantasia: data.nome_fantasia,
                situacao: data.descricao_situacao_cadastral,
                porte: data.porte,
                naturezaJuridica: data.natureza_juridica,
                atividadePrincipal: data.cnae_fiscal_descricao,
                endereco: {
                    logradouro: data.logradouro,
                    numero: data.numero,
                    bairro: data.bairro,
                    municipio: data.municipio,
                    uf: data.uf,
                    cep: data.cep
                },
                telefone: data.ddd_telefone_1,
                email: data.email
            }
        };
    } catch (error: any) {
        return { isValid: false, confidence: 0, error: error.message };
    }
}

/**
 * Valida telefone brasileiro
 */
export function validatePhone(phone: string | null): ValidationResult {
    if (!phone) {
        return { isValid: false, confidence: 100, error: 'Telefone não informado' };
    }

    const cleanPhone = phone.replace(/[^\d]/g, '');

    if (cleanPhone.length < 10 || cleanPhone.length > 11) {
        return { isValid: false, confidence: 80, error: 'Formato inválido' };
    }

    const ddd = parseInt(cleanPhone.substring(0, 2));
    const validDDDs = [
        11, 12, 13, 14, 15, 16, 17, 18, 19,
        21, 22, 24,
        27, 28,
        31, 32, 33, 34, 35, 37, 38,
        41, 42, 43, 44, 45, 46,
        47, 48, 49,
        51, 53, 54, 55,
        61,
        62, 64,
        63,
        65, 66,
        67,
        68,
        69,
        71, 73, 74, 75, 77,
        79,
        81, 82, 83, 84, 85, 86, 87, 88, 89,
        91, 92, 93, 94, 95, 96, 97, 98, 99
    ];

    if (!validDDDs.includes(ddd)) {
        return { isValid: false, confidence: 90, error: 'DDD inválido' };
    }

    const isCell = cleanPhone.length === 11;
    if (isCell && cleanPhone[2] !== '9') {
        return { isValid: false, confidence: 70, error: 'Celular deve começar com 9' };
    }

    const formatted = isCell
        ? `(${cleanPhone.slice(0, 2)}) ${cleanPhone.slice(2, 7)}-${cleanPhone.slice(7)}`
        : `(${cleanPhone.slice(0, 2)}) ${cleanPhone.slice(2, 6)}-${cleanPhone.slice(6)}`;

    return { isValid: true, confidence: 80, data: { formatted } };
}

/**
 * Valida endereço usando Nominatim (OpenStreetMap)
 */
export async function validateAddress(address: string): Promise<ValidationResult> {
    if (!address || address.length < 10) {
        return { isValid: false, confidence: 100, error: 'Endereço muito curto' };
    }

    try {
        const encoded = encodeURIComponent(address);
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1&countrycodes=br`,
            {
                headers: {
                    'User-Agent': 'VeriCorp/1.0 (contact@vericorp.com.br)'
                }
            }
        );

        if (!response.ok) {
            return { isValid: false, confidence: 50, error: `Erro Nominatim: ${response.status}` };
        }

        const data = await response.json();

        if (data.length === 0) {
            return { isValid: false, confidence: 70, error: 'Endereço não encontrado no mapa' };
        }

        const result = data[0];

        return {
            isValid: true,
            confidence: Math.min(95, Math.round(parseFloat(result.importance || 0.5) * 100)),
            data: {
                displayName: result.display_name,
                lat: parseFloat(result.lat),
                lng: parseFloat(result.lon),
                type: result.type,
                class: result.class
            }
        };
    } catch (error: any) {
        return { isValid: false, confidence: 0, error: error.message };
    }
}

/**
 * Validação completa de um lead
 * Executa todas as validações e retorna status consolidado
 */
export async function validateLead(lead: {
    name: string;
    phone?: string | null;
    address?: string;
    lat?: number;
    lng?: number;
    cnpj?: string;
}): Promise<LeadValidation> {
    const results: LeadValidation = {
        overallStatus: 'pending',
        lastValidated: new Date().toISOString(),
        details: {}
    };

    let validCount = 0;
    let totalChecks = 0;

    // 0. PRIORIDADE: Validar via Google Places (mais confiável)
    try {
        const location = lead.lat && lead.lng
            ? { lat: lead.lat, lng: lead.lng }
            : undefined;

        const googleResult = await validateBusiness(lead.name, lead.address || '', location);

        if (googleResult.exists && googleResult.googleData) {
            results.googleValid = true;
            results.details!.googleData = {
                rating: googleResult.googleData.rating,
                reviewCount: googleResult.googleData.reviewCount,
                phone: googleResult.googleData.phone,
                website: googleResult.googleData.website,
                isOpen: googleResult.googleData.isOpen
            };
            validCount++;
            console.log(`[Validation] ✅ Google Places confirmou: "${lead.name}"`);
        } else {
            results.googleValid = false;
            console.log(`[Validation] ⚠️ Google Places não encontrou: "${lead.name}"`);
        }
        totalChecks++;
    } catch (error: any) {
        console.warn('[Validation] Erro no Google Places:', error.message);
    }

    // 1. Validar telefone (sempre)
    if (lead.phone) {
        const phoneResult = validatePhone(lead.phone);
        results.phoneValid = phoneResult.isValid;
        if (phoneResult.isValid) validCount++;
        totalChecks++;
    }

    // 2. Validar endereço (se disponível e Google não validou)
    if (!results.googleValid && lead.address && lead.address.length > 10) {
        const addressResult = await validateAddress(lead.address);
        results.addressValid = addressResult.isValid;
        results.details!.addressData = addressResult.data;
        if (addressResult.isValid) validCount++;
        totalChecks++;
    }

    // 3. Validar CNPJ (se disponível)
    if (lead.cnpj) {
        const cnpjResult = await validateCNPJ(lead.cnpj);
        results.cnpjValid = cnpjResult.isValid;
        results.details!.cnpjData = cnpjResult.data;
        if (cnpjResult.isValid) validCount++;
        totalChecks++;
    }

    // Determinar status geral
    // Google Places tem peso maior (se validou, considera verificado)
    if (results.googleValid) {
        results.overallStatus = 'verified';
    } else if (totalChecks === 0) {
        results.overallStatus = 'pending';
    } else if (validCount === totalChecks) {
        results.overallStatus = 'verified';
    } else if (validCount > 0) {
        results.overallStatus = 'partial';
    } else {
        results.overallStatus = 'failed';
    }

    return results;
}
