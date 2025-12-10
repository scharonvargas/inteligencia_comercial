import { GoogleGenAI, Type } from "@google/genai";
import { BusinessEntity, BusinessStatus } from "../types";
import { dbService } from "./dbService";

const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

// Configuração de Cache com TTL (Time To Live)
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos

interface CacheEntry {
  timestamp: number;
  data: BusinessEntity[];
}

// Cache em memória para evitar chamadas repetidas na mesma sessão
const searchCache = new Map<string, CacheEntry>();

const pruneCache = () => {
  const now = Date.now();
  let deletedCount = 0;
  for (const [key, entry] of searchCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      searchCache.delete(key);
      deletedCount++;
    }
  }
  if (deletedCount > 0) {
    console.log(`🧹 Cache GC: ${deletedCount} entradas expiradas removidas.`);
  }
};

export const clearMemoryCache = () => {
  searchCache.clear();
  console.log("🧹 Cache em memória limpo manualmente.");
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
 * Analisa e limpa JSON proveniente da IA.
 * Implementa estratégia de proteção de URLs (Tokenização) antes de tentar corrigir o JSON.
 */
function cleanAndParseJSON(text: string): any[] {
  if (!text || text.trim().length === 0) return [];

  let cleaned = text;

  // 1. Remover Markdown (```json ... ```) e Comentários
  cleaned = cleaned.replace(/```json/gi, "").replace(/```/g, "").replace(/\/\/.*$/gm, "");

  // 2. Proteção de URLs (Extração e Tokenização)
  // Isso evita que caracteres em URLs (:, /, ?) quebrem a lógica de correção de chaves JSON
  const urlMap = new Map<string, string>();
  let urlCounter = 0;

  // Regex para capturar URLs http/https/www. 
  // Evita capturar aspas ou chaves de fechamento no final.
  const urlRegex = /(?:https?:\/\/[^\s"'}]+)|(?:www\.[^\s"'}]+)/g;

  cleaned = cleaned.replace(urlRegex, (match) => {
    // Remove pontuação final indesejada (ex: vírgula ou chave se a IA colou o texto)
    let url = match;
    const trailing = url.match(/[),;\]}]+$/);
    let suffix = "";
    if (trailing) {
        suffix = trailing[0];
        url = url.slice(0, -trailing[0].length);
    }
    
    const token = `__URL_PLACEHOLDER_${urlCounter++}__`;
    urlMap.set(token, url);
    return token + suffix;
  });

  // 3. Tentativa Direta (Melhor Cenário)
  try {
    const parsed = JSON.parse(cleaned);
    const restored = restoreUrls(Array.isArray(parsed) ? parsed : [parsed], urlMap);
    return restored;
  } catch (e) {
    // Falhou, continuar processamento por blocos
  }

  // 4. Estratégia de Extração de Múltiplos Objetos/Arrays
  const results: any[] = [];
  
  // Regex para capturar objetos JSON {...} ou Arrays [...]
  const objectOrArrayRegex = /(\{(?:[^{}]|(?:\{[^{}]*\}))*\})|(\[(?:[^\[\]]|(?:\[[^\[\]]*\]))*\])/g;

  let match;
  while ((match = objectOrArrayRegex.exec(cleaned)) !== null) {
    const jsonStr = match[0];
    try {
      // Tenta corrigir aspas em chaves não cotadas (ex: { name: "X" } -> { "name": "X" })
      // Como as URLs estão protegidas como tokens simples, essa regex é segura.
      let fixedJsonStr = jsonStr.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
      
      // Correção opcional: trocar aspas simples por duplas (comum em output de IA agindo como JS)
      // Seguro fazer aqui pois strings de URL já estão fora.
      fixedJsonStr = fixedJsonStr.replace(/'/g, '"');
      
      const parsed = JSON.parse(fixedJsonStr);
      const restored = restoreUrls(parsed, urlMap);
      
      if (Array.isArray(restored)) {
        results.push(...restored);
      } else if (typeof restored === 'object' && restored !== null) {
        results.push(restored);
      }
    } catch (err) {
      // Se a correção falhar, tenta o JSON original do bloco
      try {
        const parsedOriginal = JSON.parse(jsonStr);
        const restored = restoreUrls(parsedOriginal, urlMap);
        if (Array.isArray(restored)) results.push(...restored);
        else if (typeof restored === 'object') results.push(restored);
      } catch (finalErr) {
        // Ignora bloco inválido
      }
    }
  }

  return results;
}

/**
 * Função Wrapper com Retry e Structured Output (JSON Schema)
 */
async function generateContentWithRetry(
  modelId: string, 
  prompt: string, 
  isBroadSearch: boolean,
  maxRetries = 3
): Promise<any> {
  let attempt = 0;
  
  // Definição do Schema para Output Estruturado (JSON garantido)
  const businessSchema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        address: { type: Type.STRING },
        phone: { type: Type.STRING, nullable: true },
        website: { type: Type.STRING, nullable: true },
        socialLinks: { type: Type.ARRAY, items: { type: Type.STRING } },
        lastActivityEvidence: { type: Type.STRING },
        daysSinceLastActivity: { type: Type.INTEGER },
        trustScore: { type: Type.INTEGER },
        status: { type: Type.STRING },
        category: { type: Type.STRING },
        lat: { type: Type.NUMBER, nullable: true },
        lng: { type: Type.NUMBER, nullable: true },
        matchType: { type: Type.STRING }
      },
      required: ["name", "address", "trustScore", "matchType", "socialLinks"]
    }
  };

  while (attempt < maxRetries) {
    try {
      const response = await ai.models.generateContent({
        model: modelId,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          temperature: isBroadSearch ? 0.6 : 0.4,
          responseMimeType: "application/json", // Força JSON
          responseSchema: businessSchema, // Força estrutura
        },
      });
      return response;
    } catch (error: any) {
      attempt++;
      
      console.warn(`[Gemini API] Falha na tentativa ${attempt}/${maxRetries}.`);
      console.warn(`[Gemini API] Status: ${error.status || 'N/A'}`);
      console.warn(`[Gemini API] Message: ${error.message}`);
      
      if (error.message?.includes('API_KEY') || error.status === 400 || error.status === 403) {
        throw error;
      }

      if (attempt >= maxRetries) throw error;

      // Exponential Backoff with Jitter
      const baseDelay = 1000 * Math.pow(2, attempt - 1);
      const jitter = Math.random() * 500;
      const delay = Math.min(baseDelay + jitter, 10000);
      
      console.log(`[Gemini API] Aguardando ${Math.round(delay)}ms antes de tentar novamente...`);
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
  coordinates?: { lat: number, lng: number } | null
): Promise<BusinessEntity[]> => {
  if (!apiKey) {
    throw new Error("A chave da API está ausente.");
  }

  pruneCache();

  const cacheKey = `${segment.trim().toLowerCase()}-${region.trim().toLowerCase()}-${maxResults}-${coordinates ? coordinates.lat : ''}`;
  
  if (searchCache.has(cacheKey)) {
    const entry = searchCache.get(cacheKey)!;
    if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
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
    prospects.forEach(p => existingProspectsMap.add(`${p.name.toLowerCase()}|${p.address.toLowerCase()}`));
  } catch (e) {
    console.warn("Não foi possível carregar prospects do banco:", e);
  }

  const INITIAL_BATCH_SIZE = 5;
  const SUBSEQUENT_BATCH_SIZE = 25;

  const allEntities: BusinessEntity[] = [];
  const seenNames = new Set<string>();
  let attempts = 0;
  const maxLoops = Math.ceil(maxResults / 10) + 5; 

  const isBroadSearch = segment === "Varredura Geral (Multisetorial)" || segment === "";

  onProgress(`Inicializando ${isBroadSearch ? 'varredura geográfica' : 'busca segmentada'}...`);
  
  const modelId = "gemini-2.5-flash";

  while (allEntities.length < maxResults && attempts < maxLoops) {
    attempts++;
    
    const isFirstBatch = allEntities.length === 0;
    const targetBatchSize = isFirstBatch ? INITIAL_BATCH_SIZE : SUBSEQUENT_BATCH_SIZE;
    const remaining = maxResults - allEntities.length;
    const currentBatchSize = Math.min(targetBatchSize, remaining);
    
    const exclusionList = Array.from(seenNames).slice(-50).join(", ");

    if (isFirstBatch) {
       onProgress("🚀 Início Rápido: Buscando primeiros resultados essenciais...");
    } else {
       onProgress(`🔎 Buscando mais empresas (Lote ${attempts})... Total: ${allEntities.length}/${maxResults}`);
    }

    let promptTask = "";
    if (isBroadSearch) {
      promptTask = `
        1. CONTEXTO: VARREDURA GERAL DE INFRAESTRUTURA (Multisetorial).
        LOCALIZAÇÃO ALVO: "${region}".
        ${coordinates ? `📍 PONTO DE ANCORAGEM (GPS PRECISO): Lat ${coordinates.lat}, Lng ${coordinates.lng}.` : ''}

        2. ANÁLISE DE ESCOPO E PRIORIDADE (CRÍTICO):
           - Se a região for ESPECÍFICA (Rua, Avenida): Liste estabelecimentos com fachada ativa na via.
           - Se a região for AMPLA (Bairro, Cidade, Região): A prioridade é ABSOLUTA para serviços de "Alta Relevância Pública".

        3. HIERARQUIA DE RELEVÂNCIA (MODO VARREDURA GERAL):
           A IA deve priorizar a extração de empresas essenciais e de grande circulação antes de buscar nichos específicos.

           ORDEM OBRIGATÓRIA DE EXTRAÇÃO (Priority Queue):
           
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

           *REGRA DE OURO:* Em varreduras gerais, ignore "lojas de nicho" (ex: loja de botão, consultório de psicologia) até que os estabelecimentos essenciais (Nível 1) tenham sido listados. O foco é INFRAESTRUTURA COMERCIAL.

        4. INSTRUÇÃO GEOGRÁFICA:
           - Utilize as coordenadas como centro.
           - Varra do centro para a periferia buscando essas categorias prioritárias.
      `;
    } else {
      promptTask = `
        1. BUSCA FOCADA: Empresas de "${segment}" em "${region}".
        2. HIERARQUIA DE LOCALIZAÇÃO (STRICT):
           - Tente encontrar empresas NO BAIRRO/RUA ESPECIFICADO. (matchType="EXACT")
           - SE houver escassez, busque próximo.
      `;
    }

    const prompt = `
      Atue como um Especialista em Geomarketing.
      
      OBJETIVO:
      ${promptTask}
      Encontre ${currentBatchSize} empresas.
      
      5. EXCLUSÃO: Não repita: [${exclusionList}].
      
      6. DADOS OBRIGATÓRIOS (Schema Enforcement):
         - matchType: "EXACT" ou "NEARBY".
         - trustScore: 0-100.
         - lastActivityEvidence: SEJA ESPECÍFICO. Se a evidência for vaga (ex: "Post recente"), INFIRA a data ou período pelo contexto sazonal (ex: "Post de Natal" -> "Dezembro 2024").
         - daysSinceLastActivity: Número inteiro.
         - socialLinks: Array de strings (URLs).
      
      O output DEVE obedecer estritamente ao Schema JSON fornecido.
    `;

    try {
      const response = await generateContentWithRetry(modelId, prompt, isBroadSearch);

      const rawText = response.text || "[]";
      let batchData: any[] = [];
      
      // Usa a função de parse aprimorada para lidar com múltiplos objetos/formatos e URLs quebradas
      batchData = cleanAndParseJSON(rawText);

      if (!batchData || batchData.length === 0) {
        onProgress("Expandindo raio de busca...");
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
           }

           // Refinamento de métricas de atividade (Inferência)
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
            matchType: finalMatchType
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
          throw new Error("Falha na conexão com a IA.");
      }
    }
  }

  onProgress(`Concluído! ${allEntities.length} resultados.`);
  
  if (allEntities.length > 0) {
    searchCache.set(cacheKey, {
      timestamp: Date.now(),
      data: allEntities
    });
  }
  
  return allEntities;
};

export const generateOutreachEmail = async (business: BusinessEntity): Promise<string> => {
  if (!apiKey) throw new Error("Chave API não configurada.");

  const prompt = `
    Escreva um "Cold Email" B2B para: ${business.name} (${business.category}).
    Evidência: ${business.lastActivityEvidence}.
    Objetivo: Oferecer parceria.
    Seja breve, 3 parágrafos curtos.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    return response.text || "Erro ao gerar texto.";
  } catch (error) {
    return "Erro de conexão.";
  }
};