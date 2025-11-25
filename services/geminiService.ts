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
 * Parser JSON Robusto v2
 * Protege URLs antes de limpar comentários e corrige estruturas JSON malformadas comuns de LLMs.
 */
function cleanAndParseJSON(text: string): any[] {
  // 1. Tratamento de Input Vazio/Inválido
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return [];
  }

  let cleanText = text;

  // 2. Extrair conteúdo de blocos de código Markdown (```json ... ```) se existirem
  const markdownMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (markdownMatch && markdownMatch[1]) {
    cleanText = markdownMatch[1];
  }

  // 3. Isolar a estrutura de dados (encontrar o primeiro [ ou { e o último ] ou })
  const firstBracket = cleanText.indexOf('[');
  const firstBrace = cleanText.indexOf('{');
  
  let startIdx = -1;
  let endIdx = -1;
  let isArray = true;

  // Determina onde começa o JSON
  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
      startIdx = firstBracket;
      endIdx = cleanText.lastIndexOf(']');
      isArray = true;
  } else if (firstBrace !== -1) {
      startIdx = firstBrace;
      endIdx = cleanText.lastIndexOf('}');
      isArray = false;
  }

  if (startIdx !== -1 && endIdx !== -1) {
      cleanText = cleanText.substring(startIdx, endIdx + 1);
      
      // Se detectou objetos soltos (ex: {...} {...}), força array e vírgulas
      if (!isArray) {
          // Substitui "}{" por "},{" para corrigir múltiplos objetos sem array
          cleanText = `[${cleanText.replace(/}\s*{/g, '},{')}]`;
      }
  } else {
      // Se não encontrou estrutura JSON, retorna vazio sem erro (provavelmente texto de recusa da IA)
      return [];
  }

  // TENTATIVA 1: Parse direto (Otimista)
  try {
    const result = JSON.parse(cleanText);
    return Array.isArray(result) ? result : [result];
  } catch (e) {
    // Falhou? Vamos limpar.
  }

  // 4. Limpeza Avançada
  // Passo A: Proteger URLs substituindo :// por um token seguro (evita que o limpador de comentários quebre links)
  const protectedText = cleanText.replace(/:\/\//g, '__CSS__');

  // Passo B: Remover comentários de linha (agora seguro para URLs) e vírgulas sobrando
  let sanitized = protectedText
    .replace(/\/\/.*$/gm, '') // Remove // até o fim da linha
    .replace(/,(\s*[}\]])/g, '$1') // Remove vírgula antes de fechar } ou ]
    .replace(/[\x00-\x1F\x7F-\x9F]/g, ""); // Remove caracteres de controle

  // Passo C: Restaurar URLs
  sanitized = sanitized.replace(/__CSS__/g, '://');

  // TENTATIVA 2: Parse do texto sanitizado
  try {
    const result = JSON.parse(sanitized);
    return Array.isArray(result) ? result : [result];
  } catch (e) {
    console.error("Falha ao analisar JSON mesmo após sanitização.", e);
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
        2. ANÁLISE DE GRANULARIDADE:
           - Se for RUA/AVENIDA: Liste empresas situadas EXATAMENTE nesta via.
           - Se for BAIRRO: Mapeie os principais centros comerciais deste bairro.
        3. Encontre EXATAMENTE ${currentBatchSize} empresas de DIVERSOS SETORES.
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
      Atue como um agente de Business Intelligence Sênior.
      
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