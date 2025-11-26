import { GoogleGenAI } from "@google/genai";
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

/**
 * Remove entradas expiradas do cache para liberar memória (Garbage Collection)
 */
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

/**
 * Limpa todo o cache manualmente
 */
export const clearMemoryCache = () => {
  searchCache.clear();
  console.log("🧹 Cache em memória limpo manualmente.");
};

/**
 * Utilitário de espera (sleep)
 */
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Utilitário para formatar link de WhatsApp
 */
function getWhatsAppUrl(phone: string | null, companyName: string): string | null {
  if (!phone) return null;
  
  // Limpa caracteres não numéricos
  const cleanPhone = phone.replace(/\D/g, '');
  
  // Verifica se tem formato mínimo para ser celular BR (DDD + 9 dígitos) = 11 dígitos
  // Ou formato internacional
  if (cleanPhone.length < 10) return null;

  let finalNumber = cleanPhone;
  
  // Se for numero BR sem codigo de pais, adiciona 55
  if (cleanPhone.length >= 10 && cleanPhone.length <= 11) {
    finalNumber = `55${cleanPhone}`;
  }

  const message = `Olá, encontrei a ${companyName} e gostaria de saber mais sobre seus serviços.`;
  return `https://wa.me/${finalNumber}?text=${encodeURIComponent(message)}`;
}

/**
 * Parser JSON Robusto v12 (Tokenização de URLs + Stream Support)
 */
function cleanAndParseJSON(text: string): any[] {
  if (!text || typeof text !== 'string') return [];
  if (text.trim().length === 0) return [];

  // 1. Limpeza básica de Markdown
  let cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();

  // 2. TOKENIZAÇÃO DE URLS
  // Extrai URLs antes de qualquer manipulação para evitar quebras por // (comentários) ou falta de aspas.
  const urlMap = new Map<string, string>();
  let urlCounter = 0;
  
  // Regex para capturar URLs (http/https) até encontrar um delimitador JSON comum ou espaço
  cleanText = cleanText.replace(/(https?:\/\/[^\s",}\]]+)/g, (match) => {
    const token = `__URL_TOKEN_${urlCounter++}__`;
    urlMap.set(token, match);
    return token;
  });

  // 3. Remover comentários de linha (// ...)
  cleanText = cleanText.replace(/\/\/.*$/gm, '');

  // 4. Corrigir tokens sem aspas
  // Caso: "key": __URL_TOKEN__ -> "key": "__URL_TOKEN__"
  cleanText = cleanText.replace(/:\s*(__URL_TOKEN_\d+__)/g, ': "$1"');
  // Caso: [ __URL_TOKEN__ ] -> [ "__URL_TOKEN__" ] (Arrays de links)
  cleanText = cleanText.replace(/([\[,]\s*)(__URL_TOKEN_\d+__)/g, '$1"$2"');

  // 5. Normalização de Streams de Objetos (} { -> } , {)
  cleanText = cleanText.replace(/}\s*[\r\n]*\s*{/g, '},{');

  // 6. Remover Trailing Commas
  cleanText = cleanText.replace(/,(\s*[}\]])/g, '$1');

  // 7. Restaurar URLs
  // Recoloca as URLs originais nos lugares dos tokens.
  urlMap.forEach((url, token) => {
    // Usa regex global para garantir que todas as ocorrências sejam substituídas
    cleanText = cleanText.replace(new RegExp(token, 'g'), url);
  });

  // 8. Tentar Parse Direto (Caminho Feliz)
  try {
    const textToParse = cleanText.trim().startsWith('[') ? cleanText : `[${cleanText}]`;
    const result = JSON.parse(textToParse);
    return Array.isArray(result) ? result : [result];
  } catch (e) {
    // Falha silenciosa, tenta o fallback
  }

  // 9. EXTRAÇÃO CIRÚRGICA DE BLOCOS (Fallback Robusto)
  // Analisa a string caractere por caractere para extrair objetos JSON válidos
  const objects: any[] = [];
  let braceDepth = 0;
  let currentObjStr = '';
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    
    if (inString) {
      if (char === '\\' && !isEscaped) isEscaped = true;
      else if (char === '"' && !isEscaped) inString = false;
      else isEscaped = false;
      currentObjStr += char;
      continue;
    }

    if (char === '"') {
      inString = true;
      currentObjStr += char;
      continue;
    }

    if (char === '{') {
      if (braceDepth === 0) currentObjStr = ''; 
      braceDepth++;
    }

    if (braceDepth > 0) {
      currentObjStr += char;
    }

    if (char === '}') {
      braceDepth--;
      if (braceDepth === 0) {
        try {
          let safeObjStr = currentObjStr;
          // Correção de chaves sem aspas dentro do bloco extraído
          safeObjStr = safeObjStr.replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3');
          // Remover vírgulas finais dentro do bloco
          safeObjStr = safeObjStr.replace(/,(\s*})/g, '$1');
          
          const obj = JSON.parse(safeObjStr);
          objects.push(obj);
        } catch (err) {
          // Bloco ignorado se for inválido
        }
        currentObjStr = '';
      }
    }
  }

  return objects;
}

/**
 * Função Wrapper com Retry Logic
 */
async function generateContentWithRetry(
  modelId: string, 
  prompt: string, 
  isBroadSearch: boolean,
  maxRetries = 3
): Promise<any> {
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      const response = await ai.models.generateContent({
        model: modelId,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          temperature: isBroadSearch ? 0.6 : 0.4, 
        },
      });
      return response;
    } catch (error: any) {
      attempt++;
      console.warn(`Tentativa ${attempt} falhou:`, error.message);
      
      if (error.message?.includes('API_KEY') || error.status === 400 || error.status === 403) {
        throw error;
      }

      if (attempt >= maxRetries) throw error;
      const delay = 1000 * Math.pow(2, attempt - 1);
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
    throw new Error("A chave da API está ausente. Selecione um projeto Google Cloud válido com faturamento ativado.");
  }

  // 1. Limpeza Proativa do Cache
  pruneCache();

  const cacheKey = `${segment.trim().toLowerCase()}-${region.trim().toLowerCase()}-${maxResults}-${coordinates ? coordinates.lat : ''}`;
  
  // 2. Verificação de Cache
  if (searchCache.has(cacheKey)) {
    const entry = searchCache.get(cacheKey)!;
    const now = Date.now();
    
    if (now - entry.timestamp < CACHE_TTL_MS) {
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

    // PROMPT REFINADO
    let promptTask = "";
    if (isBroadSearch) {
      promptTask = `
        1. VARREDURA GEOGRÁFICA EM: ${region}.
        ${coordinates ? `CENTRO EXATO: Lat ${coordinates.lat}, Lng ${coordinates.lng}.` : ''}

        2. LÓGICA DE PRIORIZAÇÃO GEOGRÁFICA (STRICT):
           - Se for nome de RUA/AVENIDA: Liste QUALQUER negócio com frente para esta via (matchType="EXACT").
           - Se for BAIRRO/CIDADE: Priorize empresas de INFRAESTRUTURA VITAL.

        3. HIERARQUIA DE RELEVÂNCIA PÚBLICA (CRÍTICO - SEGUIR RIGOROSAMENTE):
           A lista de resultados deve ser composta OBRIGATORIAMENTE por:
           > 80% (PRIORIDADE TOTAL) - INFRAESTRUTURA VITAL E ALTO FLUXO:
             1. ALIMENTAÇÃO ESSENCIAL: Supermercados, Mercadinhos, Atacadistas, Padarias, Açougues.
             2. SAÚDE & EMERGÊNCIA: Farmácias, Drogarias 24h, Clínicas Médicas Populares, Hospitais.
             3. SERVIÇOS PÚBLICOS & UTILIDADES: Postos de Gasolina, Agências Bancárias, Lotéricas, Correios, Cartórios.
             4. COMÉRCIO DE NECESSIDADE: Oficinas Mecânicas, Borracharias, Lojas de Material de Construção.
           
           > 20% (COMPLEMENTAR) - OUTROS:
             - Restaurantes populares, Lojas de Roupas, Barbearias, Salões de Beleza.
           
           OBJETIVO: Criar um "Guia de Sobrevivência e Utilidade Pública" da região de "${region}". O usuário quer saber onde comprar comida, remédio e abastecer.

        4. Encontre EXATAMENTE ${currentBatchSize} empresas variadas seguindo essa hierarquia.
      `;
    } else {
      promptTask = `
        1. BUSCA FOCADA: Empresas de "${segment}" em "${region}".
        2. HIERARQUIA DE LOCALIZAÇÃO (STRICT):
           - Tente encontrar empresas NO BAIRRO/RUA ESPECIFICADO. (matchType="EXACT")
           - SE (e somente se) houver escassez no local exato, busque na cidade vizinha ou bairros próximos. (matchType="NEARBY" se necessário)
           - DEIXE CLARO no endereço se for outra cidade.
        3. Encontre EXATAMENTE ${currentBatchSize} resultados.
      `;
    }

    const prompt = `
      Atue como um Especialista em Geomarketing e Verificação de Dados.
      
      OBJETIVO:
      ${promptTask}
      
      5. EXCLUSÃO: Não repita estas empresas: [${exclusionList}].
      
      6. VERIFICAÇÃO DE ATIVIDADE E INFERÊNCIA INTELIGENTE:
         - Busque datas recentes de posts/reviews.
         - Se a informação exata não estiver disponível, TENTE INFERIR a atividade com base no contexto (ex: "Post sobre Volta às Aulas" = Jan/Fev 2024; "Promoção de Natal" = Dezembro).
         - Em 'lastActivityEvidence', seja específico: "Post no Instagram sobre [Assunto] em [Mês/Ano]" ou "Review no Google Maps há 2 dias".
         - Se 'daysSinceLastActivity' for < 30, considere 'ACTIVE'.
         - Priorize encontrar o telefone celular (WhatsApp) se disponível.
      
      7. FORMATO DE SAÍDA JSON OBRIGATÓRIO:
      Retorne um Array JSON com ${currentBatchSize} objetos.
      
      Campos obrigatórios:
      - matchType: "EXACT" (se for no local pedido) ou "NEARBY" (se for expansão de raio).
      - address: Endereço completo.
      - trustScore: 0 a 100 baseado na quantidade de evidências encontradas.
      
      Exemplo:
      {
        "name": "Supermercado Exemplo",
        "address": "Av. Principal, 100, Bairro Tal, Cidade - UF",
        "phone": "(11) 99999-9999",
        "matchType": "EXACT", 
        "category": "Supermercado",
        "status": "Verificado",
        "lat": -23.5, "lng": -46.6,
        "daysSinceLastActivity": 2,
        "socialLinks": ["https://instagram.com/mercado"],
        "website": "https://www.mercado.com",
        "lastActivityEvidence": "Post de ofertas de fim de semana publicado ontem no Instagram."
      }
    `;

    try {
      const response = await generateContentWithRetry(modelId, prompt, isBroadSearch);

      const rawText = response.text || "";
      const batchData = cleanAndParseJSON(rawText);

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

           const entity: BusinessEntity = {
            id: `biz-${Date.now()}-${allEntities.length + newCount}`,
            name: name,
            address: address,
            phone: item.phone || null,
            website: (item.website && typeof item.website === 'string' && item.website.startsWith('http')) ? item.website : null,
            socialLinks: validSocialLinks,
            lastActivityEvidence: item.lastActivityEvidence || "Sem dados recentes",
            daysSinceLastActivity: typeof item.daysSinceLastActivity === 'number' ? item.daysSinceLastActivity : -1,
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