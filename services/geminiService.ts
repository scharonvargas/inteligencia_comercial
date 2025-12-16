// GoogleGenAI import removed
import { BusinessEntity, BusinessStatus } from "../types";
import { dbService } from "./dbService";
import { searchRealBusinesses, OSMBusiness } from "./overpassService";
import { searchByCategory, PlaceResult } from "./placesService";

// --- Configuração de Cache Granular ---

const TTL_CONFIG = {
  BROAD_SWEEP: 120 * 60 * 1000, // 2 horas: Varreduras gerais (infraestrutura muda pouco)
  DEFAULT: 30 * 60 * 1000, // 30 minutos: Buscas segmentadas padrão
  PRECISE: 15 * 60 * 1000, // 15 minutos: Buscas exatas/GPS (permite retry mais rápido)
};

interface CacheEntry {
  timestamp: number;
  ttl: number; // TTL específico para esta entrada
  data: BusinessEntity[];
}

// Cache em memória
const searchCache = new Map<string, CacheEntry>();

/**
 * Remove entradas expiradas com base em seus TTLs individuais.
 */
const pruneCache = () => {
  const now = Date.now();
  let deletedCount = 0;

  for (const [key, entry] of searchCache.entries()) {
    const isExpired = now - entry.timestamp > entry.ttl;
    if (isExpired) {
      searchCache.delete(key);
      deletedCount++;
    }
  }

  if (deletedCount > 0) {
    console.log(`🧹 Cache GC: ${deletedCount} entradas expiradas removidas.`);
  }
};

/**
 * Limpa todo o cache manualmente.
 */
export const clearMemoryCache = () => {
  searchCache.clear();
  console.log("🧹 Cache em memória limpo totalmente.");
};

/**
 * Invalida entradas de cache específicas baseadas em correspondência de string.
 * Útil para forçar recarregamento de uma região específica.
 */
export const invalidateSpecificCache = (term: string) => {
  const termLower = term.toLowerCase().trim();
  let count = 0;
  for (const key of searchCache.keys()) {
    if (key.includes(termLower)) {
      searchCache.delete(key);
      count++;
    }
  }
  if (count > 0)
    console.log(
      `🧹 Invalidadas ${count} entradas de cache contendo "${term}".`
    );
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getWhatsAppUrl(
  phone: string | null,
  companyName: string
): string | null {
  if (!phone) return null;
  const cleanPhone = phone.replace(/\D/g, "");
  if (cleanPhone.length < 10) return null;
  let finalNumber = cleanPhone;
  if (cleanPhone.length >= 10 && cleanPhone.length <= 11) {
    finalNumber = `55${cleanPhone}`;
  }
  const message = `Olá, encontrei a ${companyName} e gostaria de saber mais sobre seus serviços.`;
  return `https://wa.me/${finalNumber}?text=${encodeURIComponent(message)}`;
}

/**
 * Função auxiliar para refinar métricas de atividade baseadas em texto vago.
 * Tenta extrair dias numéricos de evidências textuais se o número explícito falhar.
 */
function refineActivityMetrics(
  evidence: string | null,
  explicitDays: number | any
): { text: string; days: number } {
  let text = evidence?.trim() || "Sem dados recentes";
  let days = typeof explicitDays === "number" ? explicitDays : -1;

  // Se já temos um número válido (incluindo 0 para hoje), confiamos nele
  if (days >= 0) return { text, days };

  const lowerText = text.toLowerCase();

  // Tentativa de inferência via Regex no texto da evidência
  const daysMatch = lowerText.match(/(\d+)\s*(?:dias?|days?)/);
  if (daysMatch) {
    days = parseInt(daysMatch[1], 10);
  } else if (
    lowerText.includes("hoje") ||
    lowerText.includes("today") ||
    lowerText.includes("agora") ||
    lowerText.includes("minutos")
  ) {
    days = 0;
  } else if (lowerText.includes("ontem") || lowerText.includes("yesterday")) {
    days = 1;
  } else if (
    lowerText.includes("semana passada") ||
    lowerText.includes("last week")
  ) {
    days = 7;
  } else if (
    lowerText.includes("mês passado") ||
    lowerText.includes("last month")
  ) {
    days = 30;
  }

  return { text, days };
}

/**
 * Restaura URLs que foram substituídas por tokens antes do parse.
 * Percorre recursivamente objetos e arrays.
 */
function restoreUrls(data: any, map: Map<string, string>): any {
  if (typeof data === "string") {
    // Substitui todas as ocorrências de placeholders
    if (data.includes("__URL_PLACEHOLDER_")) {
      return data.replace(/__URL_PLACEHOLDER_(\d+)__/g, (match) => {
        return map.get(match) || match;
      });
    }
    return data;
  }
  if (Array.isArray(data)) {
    return data.map((item) => restoreUrls(item, map));
  }
  if (typeof data === "object" && data !== null) {
    // UNWRAPPING LOGIC: Se o objeto for apenas um wrapper para um array (ex: { BusinessEntities: [...] })
    const keys = Object.keys(data);
    if (keys.length === 1 && Array.isArray(data[keys[0]])) {
      return data[keys[0]].map((item: any) => restoreUrls(item, map));
    }

    const newObj: any = {};
    for (const key in data) {
      newObj[key] = restoreUrls(data[key], map);
    }
    return newObj;
  }
  return data;
}

/**
 * Analisa e limpa JSON proveniente da IA com alta robustez.
 */
// Helper para extração robusta de JSON usando pilha (Stack-Based)
// NOVA ABORDAGEM: Extrai cada objeto completo individualmente
function extractJSON(str: string): any {
  // Sanitize entire string first - remove control characters but preserve structure
  const sanitized = str.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, ' '); // Keep \n and \r for readability then strip

  // STRATEGY 1: Try direct parse first (ideal case)
  try {
    const direct = JSON.parse(sanitized);
    return direct;
  } catch (e) {
    // Continue to recovery strategies
  }

  // STRATEGY 2: Extract complete objects individually (handles truncation)
  const completeObjects: any[] = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < sanitized.length; i++) {
    const char = sanitized[i];

    if (escape) { escape = false; continue; }
    if (char === '\\') { escape = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (char === '{') {
      if (depth === 0) objectStart = i; // Mark start of top-level object
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0 && objectStart !== -1) {
        // Found a complete top-level object
        let objStr = sanitized.substring(objectStart, i + 1);
        try {
          // AGGRESSIVE SANITIZATION for URLs and special chars
          // 1. Replace problematic URL characters inside strings
          objStr = objStr
            .replace(/,\s*([\]}])/g, "$1") // trailing commas
            .replace(/'/g, '"') // single quotes
            .replace(/\n/g, ' ') // newlines to spaces
            .replace(/\r/g, ' ') // carriage returns to spaces
            .replace(/\t/g, ' '); // tabs to spaces

          const obj = JSON.parse(objStr);
          completeObjects.push(obj);
        } catch (e: any) {
          // LOG DETALHADO: Mostrar exatamente onde o parsing falhou
          const errorPos = e?.message?.match(/position (\d+)/)?.[1];
          const snippet = errorPos ? objStr.substring(Math.max(0, parseInt(errorPos) - 20), parseInt(errorPos) + 30) : objStr.substring(0, 100);
          console.warn("⚠️ Objeto malformado:", {
            erro: e?.message?.substring(0, 80),
            trecho: snippet,
            tamanho: objStr.length
          });
        }
        objectStart = -1;
      }
    } else if (char === '[' || char === ']') {
      // Track array depth too to avoid false object boundaries
      // This is only for nested array tracking, not for object extraction
    }
  }

  if (completeObjects.length > 0) {
    console.log(`✅ Recuperados ${completeObjects.length} objetos completos de JSON truncado.`);
    return completeObjects;
  }

  // STRATEGY 3: Legacy - try to find any valid JSON structure
  let firstOpen = sanitized.indexOf('{');
  let firstArray = sanitized.indexOf('[');

  if (firstOpen === -1 && firstArray === -1) return null;

  let startIndices = [firstOpen, firstArray].filter(i => i !== -1).sort((a, b) => a - b);

  for (let start of startIndices) {
    let stack = 0;
    inString = false;
    escape = false;

    for (let i = start; i < sanitized.length; i++) {
      const char = sanitized[i];

      if (escape) { escape = false; continue; }
      if (char === '\\') { escape = true; continue; }
      if (char === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (char === '{' || char === '[') stack++;
      if (char === '}' || char === ']') {
        stack--;
        if (stack === 0) {
          const candidate = sanitized.substring(start, i + 1);
          try {
            const fixed = candidate
              .replace(/,\s*([\]}])/g, "$1")
              .replace(/'/g, '"');
            return JSON.parse(fixed);
          } catch (e) {
            // Continue
          }
        }
      }
    }
  }

  return null;
}

function cleanAndParseJSON(text: string): any[] {
  if (!text || text.trim().length === 0) return [];

  // EARLY DETECTION
  const trimmedStart = text.trim().substring(0, 200).toLowerCase();
  if (/^(aqui est|here is|para |to find|vou |i will)/i.test(trimmedStart) && !/[\[\{]/.test(trimmedStart)) {
    console.warn("🚫 Resposta detectada como narrativa sem JSON.");
    return [];
  }

  // Handle explicit error messages from AI as empty results to trigger graceful exit/retry logic
  if (text.includes('"error":')) {
    try {
      const potentialError = JSON.parse(text);
      if (potentialError.error) {
        console.warn("🚫 AI returned an explicit error object:", potentialError.error);
        return [];
      }
    } catch (e) {
      // If parse fails, it might still be a valid mixed content, so we proceed to extraction
    }
  }

  let cleaned = text;

  // 1. Remove Markdown
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) cleaned = codeBlockMatch[1];

  // 2. Remove Comentários
  cleaned = cleaned.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  // 3. URL placeholders
  const urlMap = new Map<string, string>();
  let urlCounter = 0;
  const urlRegex = /((?:https?:\/\/(?:www\.)?|(?:www\.))[^\s"'{}\],]+)/gi;
  cleaned = cleaned.replace(urlRegex, (match) => {
    let url = match;
    const trailing = url.match(/[),;\]}]+$/);
    let suffix = "";
    if (trailing) {
      suffix = trailing[0];
      url = url.slice(0, -trailing[0].length);
    }
    if (url.endsWith(".")) url = url.slice(0, -1);
    const token = `__URL_PLACEHOLDER_${urlCounter++}__`;
    urlMap.set(token, url);
    return token + suffix;
  });

  // 4. STACK-BASED EXTRACTION (Robust)
  const parsed = extractJSON(cleaned);

  if (parsed) {
    // 5. UNWRAPPING & RESTORE
    const restored = restoreUrls(parsed, urlMap);

    if (Array.isArray(restored)) return restored;

    if (typeof restored === 'object' && restored !== null) {
      const keys = Object.keys(restored);
      // Caso { "BusinessEntities": [...] }
      for (const key of keys) {
        if (Array.isArray(restored[key]) && restored[key].length > 0) {
          return restoreUrls(restored[key], urlMap);
        }
      }
      // Caso objeto único
      return [restored];
    }
  }

  console.warn("⚠️ Falha total no parse JSON. Raw:", text.substring(0, 200));
  return [];
}

/**
 * Função Wrapper com Retry, Backoff Exponencial Aprimorado e Logs Detalhados.
 * NOTA: responseMimeType e responseSchema foram removidos para compatibilidade com a ferramenta googleSearch.
 *
 * Em desenvolvimento local, usa fallback direto para a API Gemini se o proxy não estiver disponível.
 */

// Detect if we're in development mode
const isDev = import.meta.env?.DEV || window.location.hostname === "localhost";

async function callGeminiDirect(
  modelId: string,
  prompt: string,
  isBroadSearch: boolean,
  signal?: AbortSignal
): Promise<any> {
  // Tenta usar API key do variável de ambiente ou Fallback Hardcoded para facilitar para o User
  let apiKey = import.meta.env.VITE_API_KEY;

  // AUTOMÁTICO: Se estiver em dev e sem chave, usar a chave DeepSeek do usuário direta
  if (!apiKey && import.meta.env.DEV) {
    console.log("⚡ [Local Dev] Usando chave DeepSeek automática.");
    apiKey = "sk-439006d8dade4f03bac2386aa5a10f9d";
  }

  // Fallback legado
  if (!apiKey) {
    apiKey = localStorage.getItem("vericorp_dev_api_key");
  }

  if (!apiKey) {
    throw new Error(
      'Para desenvolvimento local, configure sua API key: localStorage.setItem("vericorp_dev_api_key", "SUA_CHAVE")'
    );
  }

  // --- GROQ SUPPORT (Detection via Key Prefix) ---
  if (apiKey.startsWith("gsk_")) {
    console.log("⚡ [Local Dev] Detectada chave Groq. Usando Llama 3 via Groq.");
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "Você é um assistente JSON estrito. Responda APENAS com um array JSON de objetos 'BusinessEntity' válidos." },
          { role: "user", content: prompt }
        ],
        model: "llama-3.1-8b-instant",
        temperature: isBroadSearch ? 0.5 : 0.2,
        response_format: { type: "json_object" }
      }),
      signal
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Groq API Error ${response.status}: ${errText}`);
    }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";
    return { text, provider: "groq-local" };
  }

  // --- DEEPSEEK SUPPORT (Detection via Key Prefix 'sk-') ---
  // Nota: OpenAI também usa sk-, mas o contexto aqui é DeepSeek conforme pedido
  if (apiKey.startsWith("sk-")) {
    console.log("⚡ [Local Dev] Detectada chave DeepSeek. Usando DeepSeek-V3.");

    // IMPORTANT: Use local proxy if in Dev Mode to avoid CORS, or direct URL if production (requires server proxy then)
    const baseUrl = import.meta.env.DEV ? "/api/deepseek-proxy/chat/completions" : "https://api.deepseek.com/chat/completions";

    const response = await fetch(baseUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "Você é um assistente JSON estrito. Responda APENAS com um array JSON de objetos 'BusinessEntity' válidos. NÃO use markdown. NÃO corte o JSON." },
          { role: "user", content: prompt }
        ],
        model: "deepseek-chat",
        temperature: isBroadSearch ? 0.5 : 0.2,
        max_tokens: 8000,
        response_format: { type: "json_object" }
      }),
      signal
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`DeepSeek API Error ${response.status}: ${errText}`);
    }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "";
    return { text, provider: "deepseek-local" };
  }

  // --- GEMINI FALLBACK (Default) ---
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  const response = await fetch(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      systemInstruction: {
        parts: [{
          text: "Você é uma API REST JSON estrita. Você converte intenções de busca em dados estruturados. PROIBIDO: Gerar código (Python, JS, etc), explicações ou texto conversacional. OBRIGATÓRIO: Responder apenas com um array JSON válido de objetos BusinessEntity."
        }]
      },
      generationConfig: { temperature: isBroadSearch ? 0.65 : 0.4 },
      tools: [{ googleSearch: {} }],
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE",
        },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API Error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  if (data.provider) {
    console.log(`📡 [Provider] ${data.provider} Active`);
  }
  const text = data?.text || data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return { text, candidates: data.candidates };
}

async function generateContentWithRetry(
  modelId: string,
  prompt: string,
  isBroadSearch: boolean,
  maxRetries = 3,
  signal?: AbortSignal
): Promise<any> {
  let attempt = 0;
  const BASE_DELAY = 2500;
  const MAX_DELAY = 20000;

  while (attempt < maxRetries) {
    try {
      console.debug(`[Gemini] 🔄 Tentativa ${attempt + 1}/${maxRetries}...`);

      // Try proxy first
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelId,
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            temperature: isBroadSearch ? 0.65 : 0.4,
            safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              {
                category: "HARM_CATEGORY_HATE_SPEECH",
                threshold: "BLOCK_NONE",
              },
              {
                category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                threshold: "BLOCK_NONE",
              },
              {
                category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                threshold: "BLOCK_NONE",
              },
            ],
          },
        }),
        signal,
      });

      // If 404 or 405 in dev mode, try direct API
      if (
        !response.ok &&
        (response.status === 404 || response.status === 405) &&
        isDev
      ) {
        console.warn(
          "[Gemini] Proxy não disponível em dev, tentando API direta..."
        );
        return await callGeminiDirect(modelId, prompt, isBroadSearch, signal);
      }

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP Error ${response.status}`);
      }

      const data = await response.json();
      if (!data || (!data.text && !data.candidates?.[0]?.content)) {
        throw new Error("RESPOSTA_VAZIA: A IA não retornou conteúdo de texto.");
      }
      return data;
    } catch (error: any) {
      // If it's a network error in dev, try direct API
      if (
        isDev &&
        (error.message?.includes("Failed to fetch") ||
          error.message?.includes("405"))
      ) {
        console.warn("[Gemini] Erro de rede em dev, tentando API direta...");
        try {
          return await callGeminiDirect(modelId, prompt, isBroadSearch, signal);
        } catch (directError: any) {
          throw directError;
        }
      }

      attempt++;
      if (signal?.aborted) throw error;

      const errorMessage = error.message || "Sem mensagem de erro";
      console.warn(
        `[Gemini] ❌ Erro na tentativa ${attempt}/${maxRetries}: ${errorMessage}`
      );

      const isFatal =
        errorMessage.includes("400") ||
        errorMessage.includes("401") ||
        errorMessage.includes("403");
      if (isFatal || attempt >= maxRetries) throw error;

      const delay = Math.min(
        BASE_DELAY * Math.pow(2, attempt - 1) + Math.random() * 1000,
        MAX_DELAY
      );
      await wait(delay);
    }
  }
}

// --- NOMINATIM SERVICE (OSM) ---
interface NominatimResult {
  place_id: number;
  licence: string;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  type: string;
  importance: number;
}

async function fetchFromNominatim(query: string): Promise<NominatimResult[]> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=30&addressdetails=1`;
    // Browser enforces CORS; removing custom User-Agent to avoid preflight issues
    // Nominatim usage policy requires a valid User-Agent, but in browser context we can't easily force it without Proxy.
    // However, widely used apps often just fetch. Let's try without the header or standard headers.
    const response = await fetch(url);
    if (!response.ok) return [];
    return await response.json();
  } catch (e) {
    console.warn("Nominatim fetch failed:", e);
    return [];
  }
}

export const fetchAndAnalyzeBusinesses = async (
  segment: string,
  region: string,
  maxResults: number,
  onProgress: (msg: string) => void,
  onBatchResults: (results: BusinessEntity[]) => void,
  coordinates?: { lat: number; lng: number } | null,
  signal?: AbortSignal
): Promise<BusinessEntity[]> => {
  if (!process.env.API_KEY) {
    throw new Error(
      "A chave da API está ausente. Selecione uma chave paga para continuar."
    );
  }

  pruneCache();

  const cacheKey = `${segment.trim().toLowerCase()}-${region
    .trim()
    .toLowerCase()}-${maxResults}-${coordinates ? coordinates.lat : ""}`;

  if (searchCache.has(cacheKey)) {
    const entry = searchCache.get(cacheKey)!;
    // Verifica o TTL específico dessa entrada
    if (Date.now() - entry.timestamp < entry.ttl) {
      onProgress("⚡ Recuperando resultados do cache instantâneo...");
      const cachedData = entry.data;
      await wait(300);
      onBatchResults(cachedData);
      return cachedData;
    } else {
      searchCache.delete(cacheKey);
    }
  }

  onProgress("Sincronizando banco de dados de prospects...");
  let existingProspectsMap = new Set<string>();
  try {
    const prospects = await dbService.getAllProspects();
    prospects.forEach((p) =>
      existingProspectsMap.add(
        `${p.name.toLowerCase()}|${p.address.toLowerCase()}`
      )
    );
  } catch (e) {
    console.warn("Não foi possível carregar prospects do banco:", e);
  }

  const allEntities: BusinessEntity[] = [];
  const seenNames = new Set<string>();

  // --- HYBRID STRATEGY: GOOGLE PLACES → OVERPASS → AI ---
  // Prioridade: Google Places (mais preciso) → OSM Overpass (gratuito) → IA (fallback)

  if (segment && segment !== "Varredura Geral (Multisetorial)") {
    // 1. TENTAR GOOGLE PLACES PRIMEIRO (mais preciso e atualizado)
    onProgress("🔍 Buscando empresas no Google Places...");

    try {
      const googlePlaces = await searchByCategory(segment, region);

      if (googlePlaces.length > 0) {
        onProgress(`✅ Google Places encontrou ${googlePlaces.length} empresas REAIS!`);

        // Converte PlaceResult para BusinessEntity
        const googleEntities: BusinessEntity[] = googlePlaces.map((place, index) => ({
          id: `biz-gpl-${Date.now()}-${index}`,
          name: place.name,
          address: place.address,
          phone: place.phone || null,
          website: place.website || null,
          socialLinks: [],
          lastActivityEvidence: place.rating ? `⭐ ${place.rating} (${place.reviewCount || 0} avaliações)` : "Google Places",
          daysSinceLastActivity: 0,
          trustScore: Math.min(100, 80 + (place.rating || 0) * 4), // Rating boost
          status: place.businessStatus === 'OPERATIONAL' ? BusinessStatus.VERIFIED : BusinessStatus.ACTIVE,
          category: segment,
          lat: place.lat,
          lng: place.lng,
          isProspect: false,
          pipelineStage: 'new',
          matchType: 'EXACT' as const,
          dataSource: 'google' as const,
          verified: true, // DADOS REAIS DO GOOGLE
          enrichment: {
            googleRating: place.rating,
            googleReviewCount: place.reviewCount
          }
        }));

        allEntities.push(...googleEntities);
        onBatchResults(googleEntities);

        // Se encontrou resultados suficientes, retorna direto
        if (googleEntities.length >= maxResults * 0.8) {
          onProgress(`🎯 Retornando ${googleEntities.length} resultados verificados do Google.`);

          searchCache.set(cacheKey, {
            timestamp: Date.now(),
            ttl: TTL_CONFIG.PRECISE,
            data: allEntities,
          });

          return allEntities;
        }

        // Se poucos resultados, complementa com OSM
        onProgress(`📍 Google retornou ${googleEntities.length}. Complementando com OSM...`);
      }
    } catch (error: any) {
      console.warn('[Google Places] Erro:', error.message);
      onProgress("⚠️ Google Places indisponível. Usando OSM...");
    }

    // 2. TENTAR OVERPASS (OSM) - Gratuito e alternativo
    onProgress("🗺️ Buscando empresas reais no OpenStreetMap...");

    try {
      const osmBusinesses = await searchRealBusinesses(segment, region, maxResults);

      if (osmBusinesses.length > 0) {
        onProgress(`✅ OSM encontrou ${osmBusinesses.length} empresas REAIS verificadas!`);

        // Converte OSMBusiness para BusinessEntity
        const osmEntities: BusinessEntity[] = osmBusinesses.map((biz, index) => ({
          id: `biz-osm-${Date.now()}-${index}`,
          name: biz.name,
          address: biz.address,
          phone: biz.phone,
          website: biz.website,
          socialLinks: [],
          lastActivityEvidence: "Cadastrado no OpenStreetMap",
          daysSinceLastActivity: 0,
          trustScore: 95, // Alta confiança - dados reais
          status: BusinessStatus.ACTIVE,
          category: biz.category || segment,
          lat: biz.lat,
          lng: biz.lng,
          isProspect: false,
          pipelineStage: 'new',
          matchType: 'EXACT' as const,
          dataSource: 'osm' as const,
          verified: true, // DADOS REAIS
        }));

        allEntities.push(...osmEntities);
        onBatchResults(osmEntities);

        // Se encontrou resultados suficientes, retorna direto (Short Circuit)
        if (osmEntities.length >= maxResults * 0.5) {
          onProgress(`🎯 Retornando ${osmEntities.length} resultados verificados do OSM.`);

          searchCache.set(cacheKey, {
            timestamp: Date.now(),
            ttl: TTL_CONFIG.PRECISE,
            data: allEntities,
          });

          return allEntities;
        }

        // Mesmo com poucos resultados OSM, NÃO usamos IA (dados fake)
        // Retorna o que temos de dados reais
        if (osmEntities.length > 0) {
          onProgress(`📍 Retornando ${allEntities.length} resultados REAIS (sem dados fake da IA).`);
        }
      } else {
        onProgress("⚠️ OSM não encontrou resultados. Mostrando apenas dados do Google Places.");
      }
    } catch (error: any) {
      console.error("[Overpass] Erro:", error.message);
      onProgress("⚠️ Erro no OSM. Mostrando apenas dados do Google Places.");
    }
  }

  // --- SEM FALLBACK PARA IA ---
  // Se temos algum resultado real (Google + OSM), retorna
  if (allEntities.length > 0) {
    onProgress(`✅ Busca concluída: ${allEntities.length} empresas REAIS encontradas.`);

    searchCache.set(cacheKey, {
      timestamp: Date.now(),
      ttl: TTL_CONFIG.DEFAULT,
      data: allEntities,
    });

    return allEntities;
  }

  // Se não encontrou NADA real, retorna vazio com mensagem clara
  onProgress("❌ Nenhuma empresa encontrada nas fontes de dados reais (Google Places e OpenStreetMap).");
  onProgress("💡 Dica: Tente expandir a região ou usar termos de busca mais genéricos.");

  return [];
}

// --- FUNÇÃO LEGADA DESABILITADA (IA FAKE) ---
// A função abaixo foi desabilitada para evitar dados fake.
// Mantida como comentário para referência futura.

/*
// --- FALLBACK: LOGICA ORIGINAL (IA PURA) - DESABILITADA ---

  const INITIAL_BATCH_SIZE = 5;
  const SUBSEQUENT_BATCH_SIZE = 25;
  let attempts = 0;
  const maxLoops = Math.ceil(maxResults / 10) + 5;
  const isBroadSearch = segment === "Varredura Geral (Multisetorial)" || segment === "";

  const modelId = "gemini-2.5-flash";
  console.log("🔍 [VeriCorp v24.x] Iniciando busca (Fallback Mode)...");

  // Strike Counter
  let emptyStrikes = 0;

  while (allEntities.length < maxResults && attempts < maxLoops) {
    if (emptyStrikes >= 2) {
      console.warn("⚠️ Loop Breaker: 2 tentativas falhas consecutivas.");
      onProgress("⚠️ Busca interrompida: IA não retornou mais dados válidos.");
      break;
    }
    attempts++;

    const isFirstBatch = allEntities.length === 0;
    const targetBatchSize = isFirstBatch
      ? INITIAL_BATCH_SIZE
      : SUBSEQUENT_BATCH_SIZE;
    const remaining = maxResults - allEntities.length;
    const currentBatchSize = Math.min(targetBatchSize, remaining);

    const exclusionList = Array.from(seenNames).slice(-50).join(", ");

    if (isFirstBatch) {
      onProgress(
        "🚀 Início Rápido: Buscando primeiros resultados essenciais..."
      );
    } else {
      onProgress(
        `🔎 Buscando mais empresas (Lote ${attempts})... Total: ${allEntities.length}/${maxResults}`
      );
    }

    let promptTask = "";
    if (isBroadSearch) {
      promptTask = `
        1. CONTEXTO: VARREDURA GERAL DE INFRAESTRUTURA (Multisetorial).
        LOCALIZAÇÃO ALVO: "${region}".
        ${coordinates
          ? `📍 PONTO DE ANCORAGEM (GPS PRECISO): Lat ${coordinates.lat}, Lng ${coordinates.lng}.`
          : ""
        }

        2. ANÁLISE DE LOCALIZAÇÃO E PRECISÃO (CRÍTICO):
           - ANALISE SEMANTICAMENTE O INPUT DE LOCAL: É uma RUA/AVENIDA específica ou uma região (Bairro/Cidade)?
           
           [CENÁRIO A: INPUT É UMA VIA ESPECÍFICA (Rua, Av, Alameda)]
           - PRIORIDADE ABSOLUTA: Liste APENAS empresas com fachada ativa nesta via exata.
           - OBRIGATÓRIO: Defina \`matchType: "EXACT"\`.
           - Utilize as coordenadas fornecidas como centro da via e expanda linearmente.
           - Ignore estabelecimentos em ruas paralelas se não forem esquinas.
           
           [CENÁRIO B: INPUT É UM BAIRRO OU CIDADE]
           - Comportamento padrão de varredura em espiral a partir do centro.
           - Defina \`matchType: "NEARBY"\`.

        3. HIERARQUIA DE RELEVÂNCIA (Priority Queue):
           A IA deve priorizar a extração de empresas essenciais e de grande circulação antes de buscar nichos específicos.

           ORDEM OBRIGATÓRIA DE EXTRAÇÃO:
           
           [NÍVEL 1 - ESSENCIAIS E ALTA CIRCULAÇÃO] (Prioridade Máxima):
           - Mercados, Supermercados, Atacadistas, Hortifrutis.
           - Farmácias, Drogarias.
           - Postos de Combustível.
           - Padarias e Panificadoras (de grande fluxo).
           
           [NÍVEL 2 - SERVIÇOS E COMÉRCIO POPULAR] (Preencher após Nível 1):
           - Oficinas Mecânicas, Auto Peças.
           - Lojas de Materiais de Construção.
           - Restaurantes de fluxo diário.
           - Bancos e Lotéricas.

           [NÍVEL 3 - NICHOS] (Apenas se não houver dados suficientes nos níveis acima):
           - Lojas especializadas, Consultórios, Escritórios, Academias, Salões de Beleza pequenos.

           *REGRA DE OURO:* Se estiver no [CENÁRIO A] (Via Específica), ignore a hierarquia de nicho se necessário para preencher com QUALQUER comércio ativo na rua, mas priorize os essenciais primeiro.
      `;
    } else {
      promptTask = `
        1. BUSCA FOCADA: Empresas de "${segment}" em "${region}".
        2. HIERARQUIA DE LOCALIZAÇÃO (STRICT):
           - Tente encontrar empresas NO BAIRRO/RUA ESPECIFICADO. (matchType="EXACT")
           - SE houver escassez, busque próximo.
      `;
    }

    // Prompt SIMPLIFICADO mas com coordenadas para o mapa
    const prompt = `TAREFA: Listar ${currentBatchSize} empresas de "${segment}" em "${region}".

FORMATO OBRIGATÓRIO (JSON Array):
[{"name":"Nome","address":"Endereço","phone":"(XX)XXXX-XXXX","status":"Ativo","lat":-27.5,"lng":-48.5}]

REGRAS:
- APENAS JSON puro, sem markdown
- Campos obrigatórios: name, address, phone, status, lat, lng
- phone pode ser null se não souber
- lat/lng: coordenadas aproximadas da empresa (número decimal)
- status: "Ativo" ou "Inativo"

EXCLUSÕES (já listados): ${exclusionList || 'nenhuma'}

RESPONDA APENAS COM O ARRAY JSON:`;

    try {
      const response = await generateContentWithRetry(
        modelId,
        prompt,
        isBroadSearch
      );

      // Tratamento robusto para extrair texto da resposta
      const rawText =
        response.text ||
        response.candidates?.[0]?.content?.parts?.[0]?.text ||
        "[]";

      // Log de Debug para entender o que a IA está retornando
      if (attempts === 1) {
        console.debug("--- RAW AI RESPONSE (SAMPLE) ---");
        console.debug(rawText.substring(0, 500) + "...");
      }

      let batchData: any[] = [];

      // Usa a função de parse aprimorada para lidar com múltiplos objetos/formatos e URLs quebradas
      batchData = cleanAndParseJSON(rawText);

      if (!batchData || batchData.length === 0) {
        emptyStrikes++;
        onProgress(`IA retornou dados vazios (Strike ${emptyStrikes}/2). Tentando novamente...`);
        console.warn("Parse result was empty.");
        if (attempts >= maxLoops) break;
        await wait(2000); // Backoff Aumentado per strike
        continue;
      }

      // Reset strike
      emptyStrikes = 0;

      const batchEntities: BusinessEntity[] = [];
      let newCount = 0;

      for (const item of batchData) {
        const normalizedName = (item.name || "").toLowerCase().trim();

        if (normalizedName && !seenNames.has(normalizedName)) {
          seenNames.add(normalizedName);
          newCount++;

          const address = item.address || "Endereço Desconhecido";
          const name = item.name || "Nome Desconhecido";
          const isSaved = existingProspectsMap.has(
            `${name.toLowerCase()}|${address.toLowerCase()}`
          );

          const socialLinksRaw = Array.isArray(item.socialLinks)
            ? item.socialLinks
            : [];
          const validSocialLinks = socialLinksRaw.filter(
            (l: any) =>
              typeof l === "string" &&
              l.trim().length > 0 &&
              (l.startsWith("http") || l.startsWith("www"))
          );

          const whatsappLink = getWhatsAppUrl(item.phone, name);
          if (whatsappLink) validSocialLinks.unshift(whatsappLink);

          let finalMatchType: "EXACT" | "NEARBY" = "EXACT";
          if (item.matchType === "NEARBY" || item.matchType === "CITY_WIDE") {
            finalMatchType = "NEARBY";
          } else {
            finalMatchType = "EXACT";
          }

          const { text: evidenceText, days: evidenceDays } =
            refineActivityMetrics(
              item.lastActivityEvidence,
              item.daysSinceLastActivity
            );

          const entity: BusinessEntity = {
            id: `biz-${Date.now()}-${allEntities.length + newCount}`,
            name: name,
            address: address,
            phone: item.phone || null,
            website: item.website || null,
            socialLinks: validSocialLinks,
            lastActivityEvidence: evidenceText,
            daysSinceLastActivity: evidenceDays,
            trustScore:
              typeof item.trustScore === "number" ? item.trustScore : 50,
            status: (Object.values(BusinessStatus).includes(item.status)
              ? item.status
              : BusinessStatus.UNKNOWN) as BusinessStatus,
            category: item.category || (isBroadSearch ? "Diversos" : segment),
            lat: typeof item.lat === "number" ? item.lat : undefined,
            lng: typeof item.lng === "number" ? item.lng : undefined,
            isProspect: isSaved,
            pipelineStage: "new",
            matchType: finalMatchType,
            dataSource: 'ai',
            verified: false, // IA não é fonte verificada
          };

          batchEntities.push(entity);
        }
      }

      if (batchEntities.length > 0) {
        allEntities.push(...batchEntities);
        onBatchResults(batchEntities);
      }

      if (newCount === 0 && attempts > 2) {
        break;
      }

      await wait(500); // Small wait between successful batches
    } catch (error: any) {
      console.warn(`Erro no lote ${attempts}:`, error);

      const isRateLimit =
        error.message?.includes("429") ||
        error.message?.includes("Rate limit") ||
        error.message?.includes("Quota exceeded");

      if (isRateLimit) {
        console.warn("⏳ Rate Limit detectado. Pausando por 10s...");
        onProgress("⏳ Atingimos o limite da API. Aguardando 10s para retomar...");
        await wait(10000);
        continue; // Tenta de novo sem quebrar o loop
      }

      if (allEntities.length > 0) break;
      if (allEntities.length === 0 && attempts === 1) {
        throw new Error(error.message || "Falha na conexão com a IA.");
      }
    }
  }

  onProgress(`Concluído! ${allEntities.length} resultados.`);

  if (allEntities.length > 0) {
    // Determina o TTL baseado no tipo de busca
    let currentTTL = TTL_CONFIG.DEFAULT;
    if (isBroadSearch) {
      currentTTL = TTL_CONFIG.BROAD_SWEEP;
    } else if (coordinates) {
      currentTTL = TTL_CONFIG.PRECISE;
    }

    searchCache.set(cacheKey, {
      timestamp: Date.now(),
      ttl: currentTTL,
      data: allEntities,
    });
  }

  return allEntities;
};
*/

// --- FIM DO CÓDIGO LEGADO ---

export const generateOutreachEmail = async (
  business: BusinessEntity
): Promise<string> => {
  // Configurado via proxy agora
  const prompt = `
    Escreva um "Cold Email" B2B para: ${business.name} (${business.category}).
    Evidência: ${business.lastActivityEvidence}.
    Objetivo: Oferecer parceria.
    Seja breve, 3 parágrafos curtos.
  `;

  try {
    const response = await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        contents: prompt,
      }),
    });
    if (!response.ok) return "Erro backend.";
    const data = await response.json();
    return data.text || "Erro processamento.";
  } catch (error) {
    return "Erro de conexão.";
  }
};
