// GoogleGenAI import removed
import { BusinessEntity, BusinessStatus } from "../types";
import { dbService } from "./dbService";

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
function extractJSON(str: string): any {
  let firstOpen = str.indexOf('{');
  let firstArray = str.indexOf('[');

  // Se não achar nenhum, retorna null
  if (firstOpen === -1 && firstArray === -1) return null;

  // Decide quem vem primeiro
  let startIndices = [firstOpen, firstArray].filter(i => i !== -1).sort((a, b) => a - b);

  for (let start of startIndices) {
    let stack = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < str.length; i++) {
      const char = str[i];

      if (escape) { escape = false; continue; }
      if (char === '\\') { escape = true; continue; }
      if (char === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (char === '{' || char === '[') stack++;
      if (char === '}' || char === ']') {
        stack--;
        if (stack === 0) {
          // Potencial fim do JSON
          const candidate = str.substring(start, i + 1);
          try {
            // Limpeza básica antes de parsear
            const fixed = candidate
              .replace(/,\s*([\]}])/g, "$1") // trailing commas
              .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":') // unquoted keys
              .replace(/'/g, '"'); // single quotes
            return JSON.parse(fixed);
          } catch (e) {
            // Continue searching if this block was invalid
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
  // Tenta usar API key do localStorage ou variável de ambiente
  const apiKey =
    localStorage.getItem("vericorp_dev_api_key") ||
    import.meta.env?.VITE_API_KEY;

  if (!apiKey) {
    throw new Error(
      'Para desenvolvimento local, configure sua API key: localStorage.setItem("vericorp_dev_api_key", "SUA_CHAVE")'
    );
  }

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

  // --- HYBRID STRATEGY: OSM + AI ---
  onProgress("🗺️ Consultando OpenStreetMap (Dados Reais)...");

  let osmResults: NominatimResult[] = [];
  try {
    osmResults = await fetchFromNominatim(`${segment} in ${region}`);
    if (osmResults.length > 0) {
      onProgress(`✅ OSM encontrou ${osmResults.length} locais reais. Enriquecendo com IA...`);
    } else {
      onProgress("⚠️ OSM sem resultados diretos. Ativando busca profunda via IA...");
    }
  } catch (e) {
    console.warn("Erro no OSM, fallback para IA pura.");
  }

  // Se OSM retornou dados, usamos a IA para formatar/enriquecer esses dados REAIS
  if (osmResults.length > 0) {
    const modelId = "gemini-2.5-flash";

    const osmContext = JSON.stringify(osmResults.map(r => ({
      name: r.display_name.split(',')[0],
      full_address: r.display_name,
      lat: r.lat,
      lon: r.lon,
      type: r.type
    })).slice(0, maxResults));

    const enrichmentPrompt = `
      Tarefa: Converter dados brutos do OpenStreetMap em BusinessEntity JSON.
      Contexto: O usuário buscou "${segment}" em "${region}".
      
      DADOS BRUTOS (OSM):
      ${osmContext}

      Instruções:
      1. Use APENAS os dados fornecidos. Não invente empresas.
      2. Formate telefone como null se não houver (OSM raramente tem telefone).
      3. Infira a categoria correta baseada no nome/tipo.
      4. Status sempre "Ativo" pois consta no mapa.
      5. matchType = "EXACT" (pois vem de geocoding real).
      
      Output JSON (Array de BusinessEntity):
      `;

    try {
      const response = await generateContentWithRetry(modelId, enrichmentPrompt, false);

      // ... (Lógica de Parsing existente reutilizada abaixo ou duplicada para segurança) ...
      const rawText = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
      const batchData = cleanAndParseJSON(rawText);

      const enrichedEntities: BusinessEntity[] = batchData.map((item: any, index: number) => ({
        id: `biz-osm-${Date.now()}-${index}`,
        name: item.name,
        address: item.address || "Endereço extraído do OSM",
        phone: item.phone || null,
        website: null,
        socialLinks: [],
        lastActivityEvidence: "Validação via OpenStreetMap",
        daysSinceLastActivity: 0,
        trustScore: 90,
        status: BusinessStatus.ACTIVE,
        category: item.category || segment,
        lat: parseFloat(item.lat || "0"),
        lng: parseFloat(item.lng || "0"),
        isProspect: false,
        pipelineStage: 'new',
        matchType: 'EXACT'
      }));

      allEntities.push(...enrichedEntities);
      onBatchResults(enrichedEntities);

      // Salva no cache e retorna (Short Circuit: Se o OSM achou, confiamos nele)
      searchCache.set(cacheKey, {
        timestamp: Date.now(),
        ttl: TTL_CONFIG.PRECISE,
        data: allEntities,
      });

      return allEntities;

    } catch (err) {
      console.error("Erro no enriquecimento OSM:", err);
      onProgress("⚠️ Falha ao processar dados do mapa. Tentando método tradicional...");
      // Fallback continua abaixo
    }
  }

  // --- FALLBACK: LOGICA ORIGINAL (IA PURA) ---
  // Se OSM falhou ou retornou vazio, executamos o loop original da IA

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

    // Definindo estrutura JSON explícita no prompt
    // Prompt com Few-Shot Learning para garantir JSON
    const prompt = `
Tarefa: Atuar como API REST que converte intenção de busca em JSON estruturado de empresas reais.
Modelo: Gemini 2.5 Flash (JSON Mode STRICT)

Contexto: O usuário busca "${segment}" na região "${region}".
Meta: Listar ${currentBatchSize} resultados.

Exemplos de Comportamento Correto (Few-Shot):

[INPUT]
Buscar: Padarias em Centro, Florianópolis
[OUTPUT CORRETO]
[
  {
    "name": "Padaria Pão & Cia",
    "address": "Rua Felipe Schmidt, 100, Centro, Florianópolis - SC",
    "phone": "(48) 3222-0000",
    "website": "http://paoecia.com.br",
    "socialLinks": [],
    "lastActivityEvidence": "Review recente no Google Maps (2 dias atrás).",
    "daysSinceLastActivity": 2,
    "trustScore": 95,
    "status": "Ativo",
    "category": "Padaria",
    "matchType": "EXACT",
    "lat": -27.595,
    "lng": -48.548
  }
]

[INPUT]
Buscar: Oficinas em Palhoça
[OUTPUT CORRETO]
[
  {
    "name": "Mecânica Total",
    "address": "Av. Barão do Rio Branco, 50, Palhoça - SC",
    "phone": "(48) 3333-1111",
    "website": null,
    "socialLinks": ["https://instagram.com/mecanicatotal"],
    "lastActivityEvidence": "Postagem no Instagram hoje.",
    "daysSinceLastActivity": 0,
    "trustScore": 88,
    "status": "Ativo",
    "category": "Oficina Mecânica",
    "matchType": "EXACT",
    "lat": -27.645,
    "lng": -48.670
  }
]

---
INSTRUÇÃO DE PROIBIÇÃO CRÍTICA:
1. JAMAIS gere código Python, JavaScript ou qualquer linguagem de programação.
2. JAMAIS escreva "Aqui está o código" ou "Segue a lista".
3. Sua resposta deve ser APENAS o JSON puro. Se falhar, retorne [].

---
AGORA É SUA VEZ. EXECUTE A TAREFA REAL:

INPUT REAL:
Buscar: ${promptTask}
Exclusões: ${exclusionList}

OUTPUT JSON (APENAS ARRAY):
`;

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

      await wait(300);
    } catch (error: any) {
      console.warn(`Erro no lote ${attempts}:`, error);
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
