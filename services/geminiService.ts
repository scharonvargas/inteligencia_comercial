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
 * Parser JSON Robusto v4
 * 1. Protege URLs.
 * 2. Corrige objetos soltos (}{ -> },{).
 * 3. Corrige vírgulas trailing.
 * 4. Fallback de extração via Regex se o parse principal falhar.
 */
function cleanAndParseJSON(text: string): any[] {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return [];
  }

  // 1. Remover blocos de código Markdown
  let cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();

  // 2. Proteger URLs (substituir :// por token para não ser removido como comentário)
  const URL_TOKEN = '___URL_SCHEME___';
  cleanText = cleanText.replace(/:\/\//g, URL_TOKEN);

  // 3. Remover comentários de linha (// ...)
  cleanText = cleanText.replace(/\/\/.*$/gm, '');

  // 4. Restaurar URLs
  cleanText = cleanText.replace(new RegExp(URL_TOKEN, 'g'), '://');

  // 5. Normalizar Estrutura (Encontrar o JSON real dentro do texto)
  const firstBrace = cleanText.indexOf('{');
  const firstBracket = cleanText.indexOf('[');

  // Se não encontrar JSON, abortar
  if (firstBrace === -1 && firstBracket === -1) return [];

  let startIdx = 0;
  let endIdx = cleanText.length;

  // Determinar se começa com Array [ ou Objeto {
  // Prioriza Array se vier antes ou se não tiver objeto
  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
      startIdx = firstBracket;
      endIdx = cleanText.lastIndexOf(']') + 1;
  } else if (firstBrace !== -1) {
      startIdx = firstBrace;
      endIdx = cleanText.lastIndexOf('}') + 1;
  }

  let jsonString = cleanText.substring(startIdx, endIdx);

  // 6. Corrigir Objetos Soltos (Stream de JSON)
  // Ex: transformar "...} {..." ou "...}\n{..." em "...},{..."
  jsonString = jsonString.replace(/}\s*{/g, '},{');

  // 7. Remover vírgulas finais inválidas (Trailing Commas) antes de fechar array/objeto
  jsonString = jsonString.replace(/,(\s*[\]}])/g, '$1');

  // 8. Garantir que é um Array
  // Se o string resultante começar com {, envolve em []
  if (jsonString.trim().startsWith('{')) {
      jsonString = `[${jsonString}]`;
  }

  // TENTATIVA 1: Parse Padrão
  try {
    const result = JSON.parse(jsonString);
    return Array.isArray(result) ? result : [result];
  } catch (e) {
    console.warn("JSON Parse (Tentativa 1) falhou. Tentando extração heurística via Regex.", e);
    
    // TENTATIVA 2: Extração Heurística (Salva-vidas)
    // Se o JSON principal estiver quebrado, tenta extrair objetos individuais {...}
    // Regex não recursivo, pega o nível mais externo possível de chaves balanceadas simples
    const matches = jsonString.match(/\{[\s\S]*?\}(?=\s*(?:,|$)|\])/g);
    
    if (matches && matches.length > 0) {
      const results: any[] = [];
      for (const match of matches) {
        try {
          // Tenta parsear cada objeto individualmente
          // Remove vírgulas trailing dentro do objeto específico se houver
          const cleanMatch = match.replace(/,(\s*})/g, '$1');
          const obj = JSON.parse(cleanMatch);
          results.push(obj);
        } catch (err) {
          // Ignora objetos quebrados individualmente
        }
      }
      if (results.length > 0) return results;
    }

    return [];
  }
}

/**
 * Função Wrapper com Retry Logic (Backoff Exponencial)
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
      
      // Se for erro de autenticação ou cliente, não adianta tentar de novo
      if (error.message?.includes('API_KEY') || error.status === 400 || error.status === 403) {
        throw error;
      }

      if (attempt >= maxRetries) throw error;
      
      // Backoff exponencial: espera 1s, 2s, 4s...
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
  onBatchResults: (results: BusinessEntity[]) => void // Novo callback para streaming
): Promise<BusinessEntity[]> => {
  if (!apiKey) {
    throw new Error("A chave da API está ausente. Selecione um projeto Google Cloud válido com faturamento ativado.");
  }

  // 1. Verificação de Cache
  const cacheKey = `${segment.trim().toLowerCase()}-${region.trim().toLowerCase()}-${maxResults}`;
  if (searchCache.has(cacheKey)) {
    onProgress("Recuperando resultados do cache instantâneo...");
    const cachedData = searchCache.get(cacheKey)!;
    await wait(300); // Pequeno delay UX
    // Emite os dados do cache de uma vez
    onBatchResults(cachedData);
    return cachedData;
  }

  // 2. Pré-carregar prospects do banco para verificação rápida
  onProgress("Sincronizando banco de dados de prospects...");
  let existingProspectsMap = new Set<string>();
  try {
    const prospects = await dbService.getAllProspects();
    // Cria um Set de assinaturas "nome|endereço" para busca O(1)
    prospects.forEach(p => existingProspectsMap.add(`${p.name.toLowerCase()}|${p.address.toLowerCase()}`));
  } catch (e) {
    console.warn("Não foi possível carregar prospects do banco:", e);
  }

  const BATCH_SIZE = 20;
  const allEntities: BusinessEntity[] = [];
  const seenNames = new Set<string>();
  let attempts = 0;
  // Limite de segurança para evitar loops infinitos
  const maxLoops = Math.ceil(maxResults / BATCH_SIZE) + 4; 

  const isBroadSearch = segment === "Varredura Geral (Multisetorial)" || segment === "";

  onProgress(`Inicializando ${isBroadSearch ? 'varredura geográfica' : 'busca segmentada'}...`);
  
  const modelId = "gemini-2.5-flash";

  while (allEntities.length < maxResults && attempts < maxLoops) {
    attempts++;
    const remaining = maxResults - allEntities.length;
    // Pede um pouco a mais para compensar filtros de duplicidade
    const currentBatchSize = Math.min(BATCH_SIZE, remaining);
    
    // Lista de exclusão para evitar duplicatas (context window management)
    const exclusionList = Array.from(seenNames).slice(-40).join(", ");

    onProgress(`Buscando lote ${attempts} (Encontrados: ${allEntities.length}/${maxResults})...`);

    let promptTask = "";
    if (isBroadSearch) {
      promptTask = `
        1. REALIZE UMA VARREDURA GEOGRÁFICA DETALHADA no local: "${region}".
        2. ANÁLISE DE GRANULARIDADE E HIERARQUIA:
           - CASO A (Via Específica): Se a busca for em uma RUA ou AVENIDA, liste as empresas situadas EXATAMENTE nesta via, lado a lado.
           - CASO B (Área Ampla): Se a busca for em um BAIRRO ou CIDADE, PRIORIZE serviços essenciais e de alto fluxo (Mercados, Farmácias, Padarias, Postos de Combustível, Clínicas Populares) ANTES de buscar nichos específicos.
        3. Encontre EXATAMENTE ${currentBatchSize} empresas de DIVERSOS SETORES (Evite repetir o mesmo ramo muitas vezes).
        4. IMPORTANTE: NÃO repita estas empresas: [${exclusionList}].
      `;
    } else {
      promptTask = `
        1. Pesquise por empresas do segmento "${segment}" na região de "${region}".
        2. Encontre EXATAMENTE ${currentBatchSize} candidatos.
        3. IMPORTANTE: NÃO inclua estas empresas: [${exclusionList}].
      `;
    }

    const prompt = `
      Atue como um agente de Business Intelligence Sênior e Analista de Território.
      
      TAREFA:
      ${promptTask}
      
      5. INVESTIGAÇÃO PROFUNDA DE ATIVIDADE (Crucial):
         - Vasculhe snippets de redes sociais (Instagram, LinkedIn, Facebook).
         - Procure por DATAS EXATAS de postagens recentes (Ex: "12/10/2024").
         - Identifique o TIPO de conteúdo (ex: "Post sobre evento", "Oferta de emprego", "Mudança de cardápio", "Resposta a review").
         - Se houver reviews recentes no Google Maps, cite a data do último review.
      
      6. FILTRE: Apenas negócios operantes.
      7. CLASSIFIQUE a categoria específica.

      FORMATO DE SAÍDA:
      Retorne APENAS um Array JSON válido.
      ESTIME AS COORDENADAS (lat/lng) para plotagem.
      PRIORIZE NÚMEROS DE CELULAR/WHATSAPP no campo "phone".
      
      Exemplo de Objeto:
      {
        "name": "Nome da Empresa",
        "address": "Endereço Completo",
        "phone": "(XX) 9XXXX-XXXX", // Priorize celular
        "website": "url ou null",
        "socialLinks": ["url1", "url2"],
        "lastActivityEvidence": "Post no Instagram em 15/10/24 sobre 'Promoção de Primavera'", // SEJA ESPECÍFICO COM DATAS E TEMAS
        "daysSinceLastActivity": 2, // Calcule baseado na evidência encontrada
        "trustScore": 85,
        "category": "Categoria Específica",
        "status": "Verificado", 
        "lat": -23.55,
        "lng": -46.63
      }
    `;

    try {
      const response = await generateContentWithRetry(modelId, prompt, isBroadSearch);

      const rawText = response.text || "";
      const batchData = cleanAndParseJSON(rawText);

      if (!batchData || batchData.length === 0) {
        onProgress("IA processando dados... (Tentando rotas alternativas)");
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
           
           // Verifica se é prospect
           const isSaved = existingProspectsMap.has(`${name.toLowerCase()}|${address.toLowerCase()}`);
           
           // Gerar link de whatsapp
           const whatsappLink = getWhatsAppUrl(item.phone, name);
           const finalSocialLinks = Array.isArray(item.socialLinks) ? item.socialLinks : [];
           
           if (whatsappLink) {
             finalSocialLinks.unshift(whatsappLink);
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
            pipelineStage: 'new'
          };
          
          batchEntities.push(entity);
        }
      }

      // STREAMING: Enviar resultados deste lote IMEDIATAMENTE para a UI
      if (batchEntities.length > 0) {
        allEntities.push(...batchEntities);
        onBatchResults(batchEntities); // Callback para App.tsx
      }

      if (newCount === 0 && attempts > 1) {
        onProgress("Varredura local concluída.");
        break;
      }
      
      await wait(500); // Delay reduzido para streaming mais fluido

    } catch (error: any) {
      console.warn(`Erro no lote ${attempts}:`, error);
      if (allEntities.length > 0) {
        onProgress("Finalizando com dados parciais...");
        break; 
      }
      // Se falhar tudo no primeiro lote, lança erro
      if (allEntities.length === 0 && attempts === 1) {
          throw new Error("Não foi possível conectar à Inteligência Artificial. Verifique sua chave API ou tente novamente.");
      }
    }
  }

  onProgress(`Concluído! ${allEntities.length} empresas encontradas.`);
  
  if (allEntities.length > 0) {
    searchCache.set(cacheKey, allEntities);
  }
  
  return allEntities;
};

export const generateOutreachEmail = async (business: BusinessEntity): Promise<string> => {
  if (!apiKey) {
    throw new Error("Chave API não configurada.");
  }

  const prompt = `
    Atue como um especialista em Copywriting B2B.
    Escreva um "Cold Email" (prospecção) curto e persuasivo para:
    
    Empresa: ${business.name}
    Ramo: ${business.category}
    Evidência Recente: ${business.lastActivityEvidence}
    
    Estrutura:
    1. Assunto (Curto e intrigante)
    2. Hook (Use a evidência recente para mostrar que pesquisou sobre eles)
    3. Proposta de valor sutil
    4. CTA (Pergunta rápida para resposta sim/não)
    
    Tom de voz: Profissional, mas conversacional. Evite clichês de marketing.
    Retorne apenas o texto do e-mail.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    return response.text || "Não foi possível gerar o e-mail.";
  } catch (error) {
    console.error("Erro na geração de e-mail:", error);
    return "Erro ao conectar com a IA.";
  }
};
