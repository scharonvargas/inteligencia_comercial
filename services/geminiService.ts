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
 * Parser JSON Robusto v8 (URL Safe & Fault Tolerant)
 * Lida com URLs sem aspas, URLs quebradas, comentários e múltiplos objetos.
 */
function cleanAndParseJSON(text: string): any[] {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return [];
  }

  // 1. Limpeza básica de Markdown
  let cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();

  // 2. TOKENIZAÇÃO DE URLS (Proteção contra parser)
  // Substitui http:// e https:// por tokens seguros para evitar conflito com comentários //
  const HTTP_TOKEN = '___HTTP_PROTO___';
  const HTTPS_TOKEN = '___HTTPS_PROTO___';
  
  cleanText = cleanText
    .replace(/https:\/\//gi, HTTPS_TOKEN)
    .replace(/http:\/\//gi, HTTP_TOKEN);

  // 3. Remover comentários de linha (agora é seguro pois URLs estão tokenizadas)
  cleanText = cleanText.replace(/\/\/.*$/gm, '');

  // 4. Corrigir URLs sem aspas (Erro comum da IA: "website": ___HTTPS_PROTO___www.site.com,)
  // Procura por chave ":" seguida de espaço opcional e um dos tokens
  cleanText = cleanText.replace(/:\s*(___HTTPS_PROTO___[^\s,}\]]+|___HTTP_PROTO___[^\s,}\]]+)/g, ': "$1"');

  // 5. Restaurar URLs (reverter tokens)
  cleanText = cleanText
    .replace(new RegExp(HTTPS_TOKEN, 'g'), 'https://')
    .replace(new RegExp(HTTP_TOKEN, 'g'), 'http://');

  // 6. Normalização de Streams de Objetos (JSON Lines ou objetos concatenados)
  // Transforma `} {` ou `}\n{` em `},{` para formar um array válido se envelopado
  cleanText = cleanText.replace(/}\s*{/g, '},{');

  // 7. Tentar parse direto como Array (Caminho Feliz)
  try {
    // Se não começar com [, tenta envelopar
    const textToParse = cleanText.trim().startsWith('[') ? cleanText : `[${cleanText}]`;
    const result = JSON.parse(textToParse);
    return Array.isArray(result) ? result : [result];
  } catch (e) {
    // Falha silenciosa no caminho feliz, prossegue para heurística de extração
  }

  // 8. ESTRATÉGIA DE EXTRAÇÃO CIRÚRGICA DE BLOCOS
  // Se o JSON inteiro estiver malformado, extraímos cada objeto {...} válido individualmente.
  const objects: any[] = [];
  let braceDepth = 0;
  let currentObjStr = '';
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    
    if (inString) {
      if (char === '\\' && !isEscaped) {
        isEscaped = true;
      } else if (char === '"' && !isEscaped) {
        inString = false;
      } else {
        isEscaped = false;
      }
      currentObjStr += char;
      continue;
    }

    if (char === '"') {
      inString = true;
      currentObjStr += char;
      continue;
    }

    if (char === '{') {
      if (braceDepth === 0) currentObjStr = ''; // Começa novo objeto
      braceDepth++;
    }

    if (braceDepth > 0) {
      currentObjStr += char;
    }

    if (char === '}') {
      braceDepth--;
      if (braceDepth === 0) {
        // Fim do objeto, tenta parsear este bloco isolado
        try {
          // Limpezas extras dentro do bloco isolado
          let safeObjStr = currentObjStr;
          // Corrige chaves sem aspas (ex: name: "Valor" -> "name": "Valor")
          safeObjStr = safeObjStr.replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3');
          // Remove vírgulas trailing (ex: "a":1, } -> "a":1 })
          safeObjStr = safeObjStr.replace(/,(\s*})/g, '$1');
          
          const obj = JSON.parse(safeObjStr);
          objects.push(obj);
        } catch (err) {
          // Se falhar, tenta recuperar o que der ou ignora
        }
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
          temperature: isBroadSearch ? 0.7 : 0.4, 
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

  // 1. Limpeza Proativa do Cache (Remove itens antigos antes de começar)
  pruneCache();

  const cacheKey = `${segment.trim().toLowerCase()}-${region.trim().toLowerCase()}-${maxResults}-${coordinates ? coordinates.lat : ''}`;
  
  // 2. Verificação de Cache com Expiração Específica
  if (searchCache.has(cacheKey)) {
    const entry = searchCache.get(cacheKey)!;
    const now = Date.now();
    
    // Verifica se o cache ainda é válido (TTL)
    if (now - entry.timestamp < CACHE_TTL_MS) {
      onProgress("⚡ Recuperando resultados do cache instantâneo...");
      const cachedData = entry.data;
      await wait(300); // Pequeno delay visual
      onBatchResults(cachedData);
      return cachedData;
    } else {
      // Expira o cache antigo
      console.log(`Cache expirado para: ${cacheKey}`);
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

  // --- ESTRATÉGIA DE FAST START ---
  // Lote 1: Apenas 5 itens (muito rápido para primeira pintura)
  // Lotes seguintes: 25 itens (maior eficiência de tokens)
  const INITIAL_BATCH_SIZE = 5;
  const SUBSEQUENT_BATCH_SIZE = 25;

  const allEntities: BusinessEntity[] = [];
  const seenNames = new Set<string>();
  let attempts = 0;
  // Aumentamos o limite de loops de segurança
  const maxLoops = Math.ceil(maxResults / 10) + 5; 

  const isBroadSearch = segment === "Varredura Geral (Multisetorial)" || segment === "";

  onProgress(`Inicializando ${isBroadSearch ? 'varredura geográfica' : 'busca segmentada'}...`);
  
  const modelId = "gemini-2.5-flash";

  while (allEntities.length < maxResults && attempts < maxLoops) {
    attempts++;
    
    // Determina o tamanho do lote dinamicamente
    const isFirstBatch = allEntities.length === 0;
    const targetBatchSize = isFirstBatch ? INITIAL_BATCH_SIZE : SUBSEQUENT_BATCH_SIZE;
    
    const remaining = maxResults - allEntities.length;
    const currentBatchSize = Math.min(targetBatchSize, remaining);
    
    // Lista de exclusão para evitar duplicatas nos próximos prompts
    const exclusionList = Array.from(seenNames).slice(-50).join(", ");

    if (isFirstBatch) {
       onProgress("🚀 Início Rápido: Buscando primeiros resultados...");
    } else {
       onProgress(`🔎 Buscando mais empresas (Lote ${attempts})... Total: ${allEntities.length}/${maxResults}`);
    }

    let geoContext = `na região de "${region}"`;
    if (coordinates) {
      geoContext = `
        LOCALIZAÇÃO EXATA: Latitude ${coordinates.lat}, Longitude ${coordinates.lng}.
        INSTRUÇÃO CRÍTICA: O usuário deseja resultados NESTE PONTO ou num raio máximo de 2km.
      `;
    }

    // PROMPT REFINADO
    let promptTask = "";
    if (isBroadSearch) {
      promptTask = `
        1. VARREDURA GEOGRÁFICA EM: ${region}.
        ${coordinates ? `USAR COORDENADAS GPS: Lat ${coordinates.lat}, Lng ${coordinates.lng} como CENTRO.` : ''}

        2. LÓGICA DE PRIORIZAÇÃO GEOGRÁFICA (CRÍTICO):
           - O usuário quer empresas EXATAMENTE nesta localização: "${region}".
           - TENTATIVA #1 (Obrigatória): Busque exaustivamente por empresas cujo endereço contenha "${region}" (se for rua) ou esteja dentro do limite oficial (se for bairro).
           - CLASSIFICAÇÃO 'matchType':
             > "EXACT": Endereço contém a rua/bairro pesquisado.
             > "NEARBY": Apenas se não houver mais opções no local exato, busque num raio expandido (ruas transversais ou vizinhas).

        3. HIERARQUIA DE TIPO DE NEGÓCIO (ESSENCIAL VS NICHO):
           - CENÁRIO A (Se a busca for por RUA/AVENIDA Específica):
             > Liste QUALQUER negócio ativo nessa via (Lojas, Serviços, Escritórios). A fidelidade ao endereço é mais importante que o tipo.
           - CENÁRIO B (Se a busca for por BAIRRO/CIDADE/REGIÃO AMPLA):
             > PRIORIDADE 1 (Alta Relevância & Grande Circulação): Liste PRIMEIRO serviços essenciais como Supermercados, Farmácias, Postos de Combustível, Padarias, Bancos, Lotéricas e Correios.
             > PRIORIDADE 2 (Comércio Geral): Restaurantes, Lojas de Roupas, Academias, Salões de Beleza.
             > PRIORIDADE 3 (Nichos): Serviços especializados, escritórios, indústrias.
             > Lógica: "Se eu me mudasse para este bairro hoje, quais são os comércios vitais que eu precisaria conhecer primeiro?" Comece por eles.

        4. Encontre EXATAMENTE ${currentBatchSize} empresas variadas seguindo essa hierarquia (Focando na Prioridade 1 se for o primeiro lote).
      `;
    } else {
      promptTask = `
        1. BUSCA FOCADA: Empresas de "${segment}" em "${region}".
        2. HIERARQUIA DE LOCALIZAÇÃO (STRICT):
           - Tente encontrar empresas NO BAIRRO/RUA ESPECIFICADO. (matchType="EXACT")
           - SE (e somente se) houver escassez no local exato, busque na cidade vizinha ou bairros próximos. (matchType="NEARBY")
           - DEIXE CLARO no endereço se for outra cidade.
        3. Encontre EXATAMENTE ${currentBatchSize} resultados.
      `;
    }

    const prompt = `
      Atue como um Especialista em Geomarketing e Verificação de Dados.
      
      OBJETIVO:
      ${promptTask}
      
      5. EXCLUSÃO: Não repita estas empresas: [${exclusionList}].
      
      6. VERIFICAÇÃO DE ATIVIDADE:
         - Busque datas recentes de posts/reviews para calcular 'daysSinceLastActivity'.
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
        "name": "Supermercado Âncora",
        "address": "Av. Principal, 100, Bairro Tal, Cidade - UF",
        "phone": "(11) 99999-9999",
        "matchType": "EXACT", 
        "category": "Supermercado",
        "status": "Verificado",
        "lat": -23.5, "lng": -46.6,
        "daysSinceLastActivity": 2,
        "socialLinks": ["https://instagram.com/mercado"],
        "website": "https://www.mercado.com",
        "lastActivityEvidence": "Ofertas da semana postadas ontem no Facebook"
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
           
           // Validação robusta de links
           const socialLinksRaw = Array.isArray(item.socialLinks) ? item.socialLinks : [];
           const validSocialLinks = socialLinksRaw.filter((l: any) => typeof l === 'string' && l.trim().length > 0 && (l.startsWith('http') || l.startsWith('www')));

           // Gerar link do WhatsApp se houver telefone
           const whatsappLink = getWhatsAppUrl(item.phone, name);
           if (whatsappLink) validSocialLinks.unshift(whatsappLink);

           // Normalizar matchType
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
        // Envia o lote imediatamente para a UI
        onBatchResults(batchEntities); 
      }

      if (newCount === 0 && attempts > 2) {
        break; // Desiste se após 2 tentativas não vier nada novo
      }
      
      // Pequeno delay para não bater rate limit se for muito rápido
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
  
  // Salva no cache com o timestamp atual
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