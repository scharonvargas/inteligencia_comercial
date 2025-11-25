import { GoogleGenAI } from "@google/genai";
import { BusinessEntity, BusinessStatus } from "../types";
import { dbService } from "./dbService";

const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

// Cache em memória para evitar chamadas repetidas na mesma sessão
const searchCache = new Map<string, BusinessEntity[]>();

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
 * Parser JSON Robusto v6
 * Adiciona limpeza extra para caracteres de controle invisíveis e arrays quebrados.
 */
function cleanAndParseJSON(text: string): any[] {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return [];
  }

  // 1. Remover blocos de código Markdown e espaços extras
  let cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();

  // 2. Proteção de URLs (substituir :// por token para não ser removido como comentário)
  const URL_TOKEN = '___URL_SCHEME___';
  cleanText = cleanText.replace(/:\/\//g, URL_TOKEN);

  // 3. Remover comentários de linha (// ...)
  cleanText = cleanText.replace(/\/\/.*$/gm, '');

  // 4. Restaurar URLs
  cleanText = cleanText.replace(new RegExp(URL_TOKEN, 'g'), '://');

  // 5. Normalizar Estrutura
  const firstBrace = cleanText.indexOf('{');
  const firstBracket = cleanText.indexOf('[');

  // Se não encontrar JSON, abortar
  if (firstBrace === -1 && firstBracket === -1) return [];

  let startIdx = 0;
  let endIdx = cleanText.length;

  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
      startIdx = firstBracket;
      endIdx = cleanText.lastIndexOf(']') + 1;
  } else if (firstBrace !== -1) {
      startIdx = firstBrace;
      endIdx = cleanText.lastIndexOf('}') + 1;
  }

  let jsonString = cleanText.substring(startIdx, endIdx);

  // 6. Corrigir Objetos Soltos (Stream de JSON)
  jsonString = jsonString.replace(/}\s*{/g, '},{');
  // Remover quebras de linha dentro de strings (pode quebrar JSON.parse)
  // jsonString = jsonString.replace(/\n/g, ' '); 

  // 7. Remover vírgulas finais inválidas
  jsonString = jsonString.replace(/,(\s*[\]}])/g, '$1');

  // 8. Garantir que é um Array
  if (jsonString.trim().startsWith('{')) {
      jsonString = `[${jsonString}]`;
  }

  try {
    const result = JSON.parse(jsonString);
    return Array.isArray(result) ? result : [result];
  } catch (e) {
    console.warn("JSON Parse (Full) falhou. Tentando extração heurística.", e);
    
    // TENTATIVA 2: Extração Heurística
    const matches = jsonString.match(/\{[\s\S]*?\}(?=\s*(?:,|$)|\])/g);
    
    if (matches && matches.length > 0) {
      const results: any[] = [];
      for (const match of matches) {
        try {
          const cleanMatch = match.replace(/,(\s*})/g, '$1');
          const obj = JSON.parse(cleanMatch);
          results.push(obj);
        } catch (err) {
          // Ignora
        }
      }
      if (results.length > 0) return results;
    }

    return [];
  }
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

  const cacheKey = `${segment.trim().toLowerCase()}-${region.trim().toLowerCase()}-${maxResults}-${coordinates ? coordinates.lat : ''}`;
  if (searchCache.has(cacheKey)) {
    onProgress("Recuperando resultados do cache instantâneo...");
    const cachedData = searchCache.get(cacheKey)!;
    await wait(300);
    onBatchResults(cachedData);
    return cachedData;
  }

  onProgress("Sincronizando banco de dados de prospects...");
  let existingProspectsMap = new Set<string>();
  try {
    const prospects = await dbService.getAllProspects();
    prospects.forEach(p => existingProspectsMap.add(`${p.name.toLowerCase()}|${p.address.toLowerCase()}`));
  } catch (e) {
    console.warn("Não foi possível carregar prospects do banco:", e);
  }

  const BATCH_SIZE = 20;
  const allEntities: BusinessEntity[] = [];
  const seenNames = new Set<string>();
  let attempts = 0;
  const maxLoops = Math.ceil(maxResults / BATCH_SIZE) + 4; 

  const isBroadSearch = segment === "Varredura Geral (Multisetorial)" || segment === "";

  onProgress(`Inicializando ${isBroadSearch ? 'varredura geográfica' : 'busca segmentada'}...`);
  
  const modelId = "gemini-2.5-flash";

  while (allEntities.length < maxResults && attempts < maxLoops) {
    attempts++;
    const remaining = maxResults - allEntities.length;
    const currentBatchSize = Math.min(BATCH_SIZE, remaining);
    
    const exclusionList = Array.from(seenNames).slice(-40).join(", ");

    onProgress(`Buscando lote ${attempts} (Encontrados: ${allEntities.length}/${maxResults})...`);

    let geoContext = `na região de "${region}"`;
    if (coordinates) {
      geoContext = `
        LOCALIZAÇÃO EXATA: Latitude ${coordinates.lat}, Longitude ${coordinates.lng}.
        INSTRUÇÃO CRÍTICA: O usuário deseja resultados NESTE PONTO ou num raio máximo de 2km.
      `;
    }

    // PROMPT REFINADO: Lógica de Fallback Geográfico e Priorização de Serviços
    let promptTask = "";
    if (isBroadSearch) {
      promptTask = `
        1. VARREDURA GEOGRÁFICA EM: ${region}.
        2. ANÁLISE DE PROXIMIDADE (IMPORTANTE):
           - Prioridade A: Empresas exatamente no endereço/bairro solicitado. (Marque matchType="EXACT")
           - Prioridade B: Se houver poucas opções no local exato, expanda para num raio de 5km, MAS VOCÊ DEVE EXPLICITAR QUE É VIZINHO. (Marque matchType="NEARBY")
        3. HIERARQUIA DE RELEVÂNCIA (ESSENCIAL PARA VARREDURA):
           - O usuário quer mapear a região. Priorize as 'Âncoras Comerciais' que geram fluxo.
           - PRIORIDADE 1: Supermercados, Farmácias, Postos de Gasolina, Padarias movimentadas.
           - PRIORIDADE 2: Serviços essenciais (Oficinas, Salões, Restaurantes).
           - PRIORIDADE 3: Outros comércios variados.
           - NÃO foque em apenas um nicho. Liste diversidade.
        4. Encontre ${currentBatchSize} empresas variadas seguindo essa hierarquia.
      `;
    } else {
      promptTask = `
        1. BUSCA FOCADA: Empresas de "${segment}" em "${region}".
        2. HIERARQUIA DE LOCALIZAÇÃO (STRICT):
           - Tente encontrar empresas NO BAIRRO/RUA ESPECIFICADO. (matchType="EXACT")
           - SE (e somente se) houver escassez no local exato, busque na cidade vizinha ou bairros próximos. (matchType="NEARBY")
           - DEIXE CLARO no endereço se for outra cidade.
        3. Encontre ${currentBatchSize} resultados.
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
      
      7. FORMATO DE SAÍDA JSON OBRIGATÓRIO:
      Retorne um Array JSON.
      
      Campos obrigatórios:
      - matchType: "EXACT" (se for no local pedido) ou "NEARBY" (se for expansão de raio).
      - address: Endereço completo.
      - trustScore: 0 a 100 baseado na quantidade de evidências encontradas.
      
      Exemplo:
      {
        "name": "Supermercado Exemplo",
        "address": "Av. Principal, 100, Bairro Tal, Cidade - UF",
        "phone": "(11) ...",
        "matchType": "EXACT", 
        "category": "Supermercado",
        "status": "Verificado",
        "lat": -23.5, "lng": -46.6,
        "daysSinceLastActivity": 2,
        "socialLinks": [],
        "website": null,
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
           
           const whatsappLink = getWhatsAppUrl(item.phone, name);
           const finalSocialLinks = Array.isArray(item.socialLinks) ? item.socialLinks : [];
           if (whatsappLink) finalSocialLinks.unshift(whatsappLink);

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
            website: item.website || null,
            socialLinks: finalSocialLinks,
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

      if (newCount === 0 && attempts > 1) {
        break;
      }
      
      await wait(500); 

    } catch (error: any) {
      console.warn(`Erro no lote ${attempts}:`, error);
      if (allEntities.length > 0) break; 
      if (allEntities.length === 0 && attempts === 1) {
          throw new Error("Falha na conexão com a IA.");
      }
    }
  }

  onProgress(`Concluído! ${allEntities.length} resultados.`);
  if (allEntities.length > 0) searchCache.set(cacheKey, allEntities);
  
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