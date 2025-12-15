import { BusinessEntity, BusinessStatus } from "../types";
import { dbService } from "./dbService";
import { indexedDBCache } from "./indexedDBCache";

// --- Configuração de Cache Granular ---

const TTL_CONFIG = {
  BROAD_SWEEP: 120 * 60 * 1000, // 2 horas: Varreduras gerais (infraestrutura muda pouco)
  DEFAULT: 30 * 60 * 1000,      // 30 minutos: Buscas segmentadas padrão
  PRECISE: 15 * 60 * 1000       // 15 minutos: Buscas exatas/GPS (permite retry mais rápido)
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
    const isExpired = (now - entry.timestamp) > entry.ttl;
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
  if (count > 0) console.log(`🧹 Invalidadas ${count} entradas de cache contendo "${term}".`);
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Debounce utility for input fields - prevents excessive API calls while typing
 * @param fn Function to debounce
 * @param delay Delay in milliseconds (default 500ms)
 */
export const debounce = <T extends (...args: any[]) => any>(fn: T, delay = 500) => {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
};

function getWhatsAppUrl(phone: string | null, companyName: string): string | null {
  if (!phone) return null;
  const cleanPhone = phone.replace(/\D/g, '');
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
function refineActivityMetrics(evidence: string | null, explicitDays: number | any): { text: string, days: number } {
  let text = evidence?.trim() || "Sem dados recentes";
  let days = typeof explicitDays === 'number' ? explicitDays : -1;

  // Se já temos um número válido (incluindo 0 para hoje), confiamos nele
  if (days >= 0) return { text, days };

  const lowerText = text.toLowerCase();

  // Tentativa de inferência via Regex no texto da evidência
  const daysMatch = lowerText.match(/(\d+)\s*(?:dias?|days?)/);
  if (daysMatch) {
    days = parseInt(daysMatch[1], 10);
  } else if (lowerText.includes("hoje") || lowerText.includes("today") || lowerText.includes("agora") || lowerText.includes("minutos")) {
    days = 0;
  } else if (lowerText.includes("ontem") || lowerText.includes("yesterday")) {
    days = 1;
  } else if (lowerText.includes("semana passada") || lowerText.includes("last week")) {
    days = 7;
  } else if (lowerText.includes("mês passado") || lowerText.includes("last month")) {
    days = 30;
  }

  return { text, days };
}

/**
 * Restaura URLs que foram substituídas por tokens antes do parse.
 * Percorre recursivamente objetos e arrays.
 */
function restoreUrls(data: any, map: Map<string, string>): any {
  if (typeof data === 'string') {
    // Substitui todas as ocorrências de placeholders
    if (data.includes('__URL_PLACEHOLDER_')) {
      return data.replace(/__URL_PLACEHOLDER_(\d+)__/g, (match) => {
        return map.get(match) || match;
      });
    }
    return data;
  }
  if (Array.isArray(data)) {
    return data.map(item => restoreUrls(item, map));
  }
  if (typeof data === 'object' && data !== null) {
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
/**
 * Analisa e limpa JSON proveniente da IA com alta robustez.
 * Suporta JSON padrão (Array) e JSON Lines (NDJSON) para resiliência contra truncamento.
 */
function cleanAndParseJSON(text: string): any[] {
  if (!text || text.trim().length === 0) return [];

  let cleaned = text;

  // 1. Extrair conteúdo de blocos de código Markdown (prioridade)
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1];
  }

  // 2. Remover comentários JS (// ou /* */)
  cleaned = cleaned.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  // 3. Remover citações de grounding (ex: [1], [2])
  cleaned = cleaned.replace(/\[\d+\]/g, "");

  const results: any[] = [];
  const urlMap = new Map<string, string>();

  // Estratégia A: Tentar parse como JSON Array completo
  try {
    const fixedJsonStr = cleaned.replace(/'/g, '"'); // Normaliza aspas simples
    const parsed = JSON.parse(fixedJsonStr);
    if (Array.isArray(parsed)) return restoreUrls(parsed, urlMap);
    if (typeof parsed === 'object' && parsed !== null) return [restoreUrls(parsed, urlMap)];
  } catch (e) {
    // Falha normal se estiver truncado ou for NDJSON
  }

  // Estratégia B: Parse Linha a Linha (NDJSON / JSON Lines)
  // Divide por quebras de linha e tenta parsear cada linha como um objeto
  const lines = cleaned.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Ignora início/fim de array solto
    if (trimmed === '[' || trimmed === ']') continue;
    // Remove vírgula final se houver (comum em listas)
    const lineContent = trimmed.replace(/,$/, '');

    try {
      const parsed = JSON.parse(lineContent);
      if (parsed && typeof parsed === 'object') {
        results.push(parsed);
      }
    } catch (e) {
      // Linha inválida, ignora
    }
  }

  if (results.length > 0) return restoreUrls(results, urlMap);

  // Estratégia C: Regex Fallback (Último recurso para extrair objetos em texto sujo)
  const regex = /(\{(?:[^{}]|(?:\{[^{}]*\}))*\})/g;
  let match;
  while ((match = regex.exec(cleaned)) !== null) {
    const jsonStr = match[0];
    try {
      const fixedJsonStr = jsonStr.replace(/'/g, '"');
      const parsed = JSON.parse(fixedJsonStr);
      results.push(parsed);
    } catch (err) {
      // Ignora fragmentos inválidos
    }
  }

  if (results.length === 0 && text.length > 50) {
    console.warn("⚠️ Falha ao fazer parse do JSON. Texto bruto (início):", text.substring(0, 200) + "...");
  }

  return restoreUrls(results, urlMap);
}

/**
 * Função Wrapper com Retry, Backoff Exponencial Aprimorado e Logs Detalhados.
 * AGORA SEGURA: Usa o proxy /api/gemini para não expor a API Key no cliente.
 */
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
      if (signal?.aborted) throw new Error("Busca cancelada pelo usuário.");

      console.debug(`[Gemini Proxy] 🔄 Tentativa ${attempt + 1}/${maxRetries} iniciada...`);

      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            temperature: isBroadSearch ? 0.65 : 0.4,
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ]
          }
        }),
        signal
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw {
          status: response.status,
          statusText: response.statusText,
          message: errorBody.error || errorBody.details || "Erro na requisição ao Proxy",
          error: errorBody
        };
      }

      const data = await response.json();

      // Validação básica se há conteúdo
      if (!data || (!data.candidates?.[0]?.content)) {
        throw new Error("RESPOSTA_VAZIA: A IA não retornou conteúdo de texto válido via Proxy.");
      }

      return data;

    } catch (error: any) {
      if (signal?.aborted || error.name === 'AbortError') throw new Error("Busca cancelada pelo usuário.");

      attempt++;
      const status = error.status || 500;
      const errorMessage = error.message || 'Erro Desconhecido';

      console.groupCollapsed(`[Gemini Proxy] ❌ Erro na tentativa ${attempt}/${maxRetries}`);
      console.warn(`Status: ${status}`);
      console.warn(`Mensagem: ${errorMessage}`);
      console.groupEnd();

      // Fatal errors - don't retry
      const isFatal = errorMessage.includes('API_KEY') || status === 400 || status === 401;
      if (isFatal) throw error;

      // 503 Overload - longer wait + user-friendly message
      if (status === 503 || errorMessage.includes('overloaded')) {
        console.warn("🔄 Modelo sobrecarregado (503). Aguardando 8s antes de retry...");
        if (attempt >= maxRetries) {
          throw new Error("⏳ A IA está sobrecarregada. Tente novamente em alguns minutos ou use uma busca menor.");
        }
        await wait(8000); // Wait 8 seconds for 503
        continue;
      }

      // 429 Rate Limit - exponential backoff
      if (status === 429) {
        const rateLimitDelay = Math.min(5000 * attempt, 30000);
        console.warn(`⏱️ Rate limit (429). Aguardando ${rateLimitDelay / 1000}s...`);
        await wait(rateLimitDelay);
        continue;
      }

      if (attempt >= maxRetries) throw error;

      const delay = Math.min(BASE_DELAY * Math.pow(2, attempt - 1), MAX_DELAY);
      await wait(delay);
    }
  }
}

export const fetchAndAnalyzeBusinesses = async (
  segment: string,
  region: string,
  maxResults: number,
  onProgress: (msg: string) => void,
  onBatchResults: (results: BusinessEntity[]) => void,
  coordinates?: { lat: number, lng: number } | null,
  signal?: AbortSignal
): Promise<BusinessEntity[]> => {
  pruneCache();

  const cacheKey = `${segment.trim().toLowerCase()}-${region.trim().toLowerCase()}-${maxResults}-${coordinates ? coordinates.lat : ''}`;

  // 1. Check IndexedDB Persistent Cache First
  try {
    const persistentCache = await indexedDBCache.get(cacheKey);
    if (persistentCache) {
      onProgress(`⚡ Cache persistente encontrado! ${persistentCache.data.length} resultados (${persistentCache.exactCount} exatos)`);
      await wait(50);
      onBatchResults(persistentCache.data as BusinessEntity[]);
      return persistentCache.data as BusinessEntity[];
    }
  } catch (e) {
    console.warn("IndexedDB cache check failed:", e);
  }

  // 2. Check Memory Cache (faster but ephemeral)
  if (searchCache.has(cacheKey)) {
    const entry = searchCache.get(cacheKey)!;
    if (Date.now() - entry.timestamp < entry.ttl) {
      onProgress("⚡ Recuperando resultados do cache instantâneo...");
      const cachedData = entry.data;
      await wait(50);
      onBatchResults(cachedData);
      return cachedData;
    } else {
      searchCache.delete(cacheKey);
    }
  }

  // Telemetry counters
  let telemetry = { exactCount: 0, nearbyCount: 0, parseErrors: 0 };

  onProgress("Sincronizando banco de dados de prospects...");
  let existingProspectsMap = new Set<string>();
  try {
    const prospects = await dbService.getAllProspects();
    prospects.forEach(p => existingProspectsMap.add(`${p.name.toLowerCase()}|${p.address.toLowerCase()}`));
  } catch (e) {
    console.warn("Não foi possível carregar prospects do banco:", e);
  }

  // Smart batch sizing: starts at 10, scales dynamically
  // For small searches (10-20): single batch of exact size
  // For medium searches (20-50): 10 initial, then 20 per batch
  // For large searches (50+): 10 initial, then 30 per batch
  const INITIAL_BATCH_SIZE = Math.min(10, maxResults);
  const SUBSEQUENT_BATCH_SIZE = maxResults <= 20 ? maxResults : (maxResults <= 50 ? 20 : 30);

  const allEntities: BusinessEntity[] = [];
  const seenNames = new Set<string>();
  let attempts = 0;
  const maxLoops = Math.ceil(maxResults / INITIAL_BATCH_SIZE) + 3;

  const isBroadSearch = segment === "Varredura Geral (Multisetorial)" || segment === "";

  // Time estimation (based on historical averages: ~3s per 10 results)
  const estimatedTimeMs = Math.max(5000, (maxResults / 10) * 3000);
  const startTime = Date.now();

  const getTimeRemaining = () => {
    const elapsed = Date.now() - startTime;
    const progress = Math.max(allEntities.length / maxResults, 0.1);
    const estimatedTotal = elapsed / progress;
    const remaining = Math.max(0, estimatedTotal - elapsed);
    return Math.ceil(remaining / 1000);
  };

  onProgress(`Inicializando ${isBroadSearch ? 'varredura geográfica' : 'busca segmentada'}... (~${Math.ceil(estimatedTimeMs / 1000)}s)`);

  const modelId = "gemini-2.5-flash";

  // Parallel workers configuration
  const PARALLEL_WORKERS = 3;
  const workerOffsets = ['CENTRAL', 'NORTE/LESTE', 'SUL/OESTE'];

  // Use parallel mode for larger result sets
  const useParallelMode = maxResults >= 30;

  if (useParallelMode) {
    onProgress(`⚡ Modo Turbo: ${PARALLEL_WORKERS} buscas paralelas ativadas...`);
  }

  while (allEntities.length < maxResults && attempts < maxLoops) {
    if (signal?.aborted) {
      onProgress("⚠️ Busca interrompida pelo usuário.");
      break;
    }
    attempts++;

    const isFirstBatch = allEntities.length === 0;
    const targetBatchSize = isFirstBatch ? INITIAL_BATCH_SIZE : SUBSEQUENT_BATCH_SIZE;
    const remaining = maxResults - allEntities.length;
    const currentBatchSize = Math.min(targetBatchSize, remaining);

    const exclusionList = Array.from(seenNames).slice(-50).join(", ");

    if (isFirstBatch) {
      onProgress("🚀 Início Rápido: Buscando primeiros resultados essenciais...");
    } else {
      const eta = getTimeRemaining();
      onProgress(`🔎 Buscando mais empresas (Lote ${attempts})... ${allEntities.length}/${maxResults} ${eta > 0 ? `(~${eta}s restantes)` : ''}`);
    }

    let promptTask = "";
    if (isBroadSearch) {
      promptTask = `
        1. CONTEXTO: VARREDURA GERAL DE INFRAESTRUTURA (Multisetorial).
        LOCALIZAÇÃO ALVO: "${region}".
        ${coordinates ? `📍 PONTO DE ANCORAGEM (GPS PRECISO): Lat ${coordinates.lat}, Lng ${coordinates.lng}.` : ''}

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

        3. AI LEAD SCORING (Viability Check):
           Para cada empresa, calcule o 'viabilityScore' (0-100) baseado em:
           - Tem site ou rede social ativa? (+30 pts)
           - Tem telefone? (+20 pts)
           - Atividade recente (Evidência < 30 dias)? (+30 pts)
           - Nicho correto? (+20 pts)
           
           Gere uma 'viabilityReason' curta (ex: "Alta maturidade digital, site e insta ativos").

      `;
    }

    // Definindo estrutura JSON explícita no prompt (FORMATO NDJSON / JSON LINES)
    const prompt = `
      Atue como um Especialista em Geomarketing.
      
      OBJETIVO:
      ${promptTask}
      Encontre ${currentBatchSize} empresas.
      
      5. EXCLUSÃO: Não repita: [${exclusionList}].
      
      6. FORMATO DE SAÍDA OBRIGATÓRIO (NDJSON / JSON LINES):
      - Retorne ESTRITAMENTE um objeto JSON por linha.
      - NÃO envolva em colchetes [].
      - NÃO use vírgulas entre os objetos (apenas quebra de linha).
      - NÃO use markdown (sem \`\`\`json).
      - Exemplo:
      {"name": "A", ...}
      {"name": "B", ...}

      Estrutura de CADA LINHA (Objeto):
      {
        "name": "Nome da Empresa",
        "address": "Endereço completo",
        "phone": "Telefone ou null",
        "website": "URL ou null",
        "socialLinks": ["URL1", "URL2"],
        "lastActivityEvidence": "Texto específico sobre evidência recente",
        "daysSinceLastActivity": 2,
        "trustScore": 85,
        "matchType": "EXACT",
        "lat": -23.55,
        "lng": -46.63,
        "cnpj": "00.000.000/0001-91",
        "viabilityScore": 85,
        "viabilityReason": "Site e Instagram ativos, postou ontem."
      }

      REGRAS DE DADOS:
       - Tente extrair o CNPJ se estiver visível ou facilmente inferível. Se não, deixe null.
       - matchType: Use "EXACT" se estiver na rua/local solicitado, "NEARBY" se for próximo.
    `;

    try {
      if (signal?.aborted) break;
      const response = await generateContentWithRetry(modelId, prompt, isBroadSearch, 3, signal);

      // Tratamento robusto para extrair texto da resposta via Proxy
      const rawText =
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
        onProgress("IA retornou dados fora do formato. Tentando novamente...");
        console.warn("Parse result was empty.");
        if (attempts >= maxLoops) break;
        continue;
      }

      const batchEntities: BusinessEntity[] = [];
      let newCount = 0;

      for (const item of batchData) {
        const normalizedName = (item.name || "").toLowerCase().trim();

        if (normalizedName && !seenNames.has(normalizedName)) {
          seenNames.add(normalizedName);
          newCount++;

          const address = item.address || "Endereço Desconhecido";
          const name = item.name || "Nome Desconhecido";
          const isSaved = existingProspectsMap.has(`${name.toLowerCase()}|${address.toLowerCase()}`);

          const socialLinksRaw = Array.isArray(item.socialLinks) ? item.socialLinks : [];
          const validSocialLinks = socialLinksRaw.filter((l: any) => typeof l === 'string' && l.trim().length > 0 && (l.startsWith('http') || l.startsWith('www')));

          const whatsappLink = getWhatsAppUrl(item.phone, name);
          if (whatsappLink) validSocialLinks.unshift(whatsappLink);

          let finalMatchType: 'EXACT' | 'NEARBY' = 'EXACT';
          if (item.matchType === 'NEARBY' || item.matchType === 'CITY_WIDE') {
            finalMatchType = 'NEARBY';
          } else {
            finalMatchType = 'EXACT';
          }

          const { text: evidenceText, days: evidenceDays } = refineActivityMetrics(item.lastActivityEvidence, item.daysSinceLastActivity);

          const entity: BusinessEntity = {
            id: `biz-${Date.now()}-${allEntities.length + newCount}`,
            name: name,
            address: address,
            phone: item.phone || null,
            website: item.website || null,
            socialLinks: validSocialLinks,
            lastActivityEvidence: evidenceText,
            daysSinceLastActivity: evidenceDays,
            trustScore: typeof item.trustScore === 'number' ? item.trustScore : 50,
            status: (Object.values(BusinessStatus).includes(item.status) ? item.status : BusinessStatus.UNKNOWN) as BusinessStatus,
            category: item.category || (isBroadSearch ? "Diversos" : segment),
            lat: typeof item.lat === 'number' ? item.lat : undefined,
            lng: typeof item.lng === 'number' ? item.lng : undefined,
            isProspect: isSaved,
            pipelineStage: 'new',
            matchType: finalMatchType,
            viabilityScore: typeof item.viabilityScore === 'number' ? item.viabilityScore : (typeof item.trustScore === 'number' ? item.trustScore : 50),
            viabilityReason: item.viabilityReason || "Sem análise detalhada."
          };

          batchEntities.push(entity);

          // Telemetry tracking
          if (finalMatchType === 'EXACT') telemetry.exactCount++;
          else telemetry.nearbyCount++;
        }
      }

      if (batchEntities.length > 0) {
        allEntities.push(...batchEntities);
        onBatchResults(batchEntities);
      }

      if (newCount === 0 && attempts > 2) {
        break;
      }

      await wait(50);

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
      data: allEntities
    });

    // Save to IndexedDB for persistence (async, don't block)
    try {
      indexedDBCache.set(cacheKey, allEntities, telemetry.exactCount, telemetry.nearbyCount);
    } catch (e) {
      console.warn('IndexedDB save failed:', e);
    }

    // Log telemetry
    console.log(`📊 Telemetry: ${telemetry.exactCount} EXACT, ${telemetry.nearbyCount} NEARBY (${((telemetry.exactCount / allEntities.length) * 100).toFixed(1)}% precisão)`);
  }

  return allEntities;
};

export const generateOutreachEmail = async (business: BusinessEntity): Promise<string> => {
  // Chamada via proxy para proteger chave
  const prompt = `
    Escreva um "Cold Email" B2B para: ${business.name} (${business.category}).
    Evidência: ${business.lastActivityEvidence}.
    Objetivo: Oferecer parceria.
    Seja breve, 3 parágrafos curtos.
  `;

  try {
    const response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        contents: prompt
      })
    });
    const text = await response.text();
    return text || "Erro ao gerar texto.";
  } catch (error) {
    return "Erro de conexão.";
  }
};

export const analyzeCompetitors = async (business: BusinessEntity): Promise<any> => {
  const prompt = `
     Atue como um Especialista de Mercado Local.
     Analise 3 concorrentes diretos (reais ou prováveis) para: ${business.name} (${business.category}) em ${business.address}.
     
     Para cada concorrente, identifique:
     - Pontos Fortes (Strengths)
     - Pontos Fracos (Weaknesses)
     - Diferencial Competitivo
     
     
     Retorne APENAS JSON válido neste formato:
     {
       "marketSummary": "Breve frase sobre o nível de competitividade da região.",
       "competitors": [
         {
           "name": "Nome do Concorrente",
           "strengths": ["Forte 1", "Forte 2"],
           "weaknesses": ["Fraco 1", "Fraco 2"],
           "differentiator": "O que eles tem de único"
         }
       ]
     }
   `;

  try {
    const response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        contents: prompt
      })
    });
    const text = await response.text();
    const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Erro ao analisar concorrentes:", error);
    return null;
  }
};

export const generateOmnichannelScripts = async (business: BusinessEntity): Promise<any> => {
  const prompt = `
    Crie um "Kit de Outreach Omnichannel" B2B para: ${business.name} (${business.category}).
    Evidência: ${business.lastActivityEvidence}.
    
    Gere 4 scripts distintos, curtos e profissionais de venda:
    
    1. EMAIL: Assunto + Corpo (3 parágrafos curtos, tom consultivo).
    2. WHATSAPP: Mensagem direta e casual (sem "Prezado", use emojis leves).
    3. LINKEDIN: Nota de conexão (max 300 chars) personalizada.
    4. SCRIPT TELEFÔNICO: Roteiro para passar pela secretária (Gatekeeper) e falar com decisor.
    
    FORMATO DE SAÍDA (JSON OBRIGATÓRIO):
    {
      "email": "Assunto: ... Corpo: ...",
      "whatsapp": "Oi [Nome] ...",
      "linkedin": "Olá ...",
      "phoneScript": "Secretária: ... Você: ..."
    }
    
    NÃO use markdown (\`\`\`json), apenas o objeto JSON puro.
  `;

  try {
    const response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        contents: prompt
      })
    });

    const text = await response.text();
    // Limpeza básica para garantir que seja JSON
    const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Erro ao gerar scripts:", error);
    return {
      email: "Erro ao gerar email.",
      whatsapp: "Erro ao gerar WhatsApp.",
      linkedin: "Erro ao gerar LinkedIn.",
      phoneScript: "Erro ao gerar script."
    };
  }
};