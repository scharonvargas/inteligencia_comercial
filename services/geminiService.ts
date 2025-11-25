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
 * Parser JSON Robusto
 * Tenta limpar e corrigir a string retornada pela IA antes de fazer o parse.
 */
function cleanAndParseJSON(text: string): any[] {
  let cleanText = text;

  // 1. Extrair conteúdo de blocos de código Markdown (```json ... ```)
  const markdownMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (markdownMatch && markdownMatch[1]) {
    cleanText = markdownMatch[1];
  }

  // 2. Encontrar o array JSON mais externo
  const firstBracket = cleanText.indexOf('[');
  const lastBracket = cleanText.lastIndexOf(']');
  
  if (firstBracket !== -1 && lastBracket !== -1) {
    cleanText = cleanText.substring(firstBracket, lastBracket + 1);
  } else {
    // Se não achar array, tenta achar objeto único e colocar num array
    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
       cleanText = `[${cleanText.substring(firstBrace, lastBrace + 1)}]`;
    }
  }

  // 3. Limpeza de erros comuns de sintaxe JSON gerados por LLMs
  cleanText = cleanText
    // Remove comentários //
    .replace(/\/\/.*$/gm, '') 
    // Remove vírgulas trailing (vírgula antes de fechar } ou ])
    .replace(/,(\s*[}\]])/g, '$1')
    // Remove caracteres de controle invisíveis
    .replace(/[\x00-\x1F\x7F-\x9F]/g, ""); 

  try {
    const result = JSON.parse(cleanText);
    return Array.isArray(result) ? result : [];
  } catch (e) {
    console.error("Falha crítica ao analisar JSON. Texto bruto:", text);
    console.error("Texto limpo tentado:", cleanText);
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
  onProgress: (msg: string) => void
): Promise<BusinessEntity[]> => {
  if (!apiKey) {
    throw new Error("A chave da API está ausente. Selecione um projeto Google Cloud válido com faturamento ativado.");
  }

  // 1. Verificação de Cache
  const cacheKey = `${segment.trim().toLowerCase()}-${region.trim().toLowerCase()}-${maxResults}`;
  if (searchCache.has(cacheKey)) {
    onProgress("Recuperando resultados do cache instantâneo...");
    await wait(600); // Pequeno delay UX
    return searchCache.get(cacheKey)!;
  }

  const BATCH_SIZE = 20;
  const allEntities: BusinessEntity[] = [];
  const seenNames = new Set<string>();
  let attempts = 0;
  // Limite de segurança para evitar loops infinitos se a IA retornar poucos resultados
  const maxLoops = Math.ceil(maxResults / BATCH_SIZE) + 3; 

  const isBroadSearch = segment === "Varredura Geral (Multisetorial)" || segment === "";

  onProgress(`Inicializando ${isBroadSearch ? 'varredura geográfica' : 'busca segmentada'} em "${region}" para meta de ${maxResults} empresas...`);
  
  const modelId = "gemini-2.5-flash";

  while (allEntities.length < maxResults && attempts < maxLoops) {
    attempts++;
    const remaining = maxResults - allEntities.length;
    // Pede um pouco a mais para compensar filtros de duplicidade
    const currentBatchSize = Math.min(BATCH_SIZE, remaining);
    
    // Lista de exclusão para evitar duplicatas (context window management)
    const exclusionList = Array.from(seenNames).slice(-40).join(", ");

    onProgress(`Executando lote ${attempts}/${Math.ceil(maxResults/BATCH_SIZE)}: Buscando ${currentBatchSize} empresas (Total acumulado: ${allEntities.length})...`);

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
      Atue como um agente de Business Intelligence.
      
      TAREFA:
      ${promptTask}
      5. ANALISE sinais de atividade recente.
      6. FILTRE: Apenas negócios operantes.
      7. CLASSIFIQUE a categoria específica.
      
      FORMATO DE SAÍDA:
      Retorne APENAS um Array JSON válido.
      ESTIME AS COORDENADAS (lat/lng) para plotagem.
      
      Exemplo de Objeto:
      {
        "name": "Nome da Empresa",
        "address": "Endereço Completo",
        "phone": "(XX) XXXX-XXXX",
        "website": "url ou null",
        "socialLinks": ["url1", "url2"],
        "lastActivityEvidence": "Post Instagram 2 dias atrás",
        "daysSinceLastActivity": 2,
        "trustScore": 85,
        "category": "Categoria Específica",
        "status": "Verificado", 
        "lat": -23.55,
        "lng": -46.63
      }
    `;

    try {
      // Usa a função com retry ao invés de chamar direto
      const response = await generateContentWithRetry(modelId, prompt, isBroadSearch);

      const rawText = response.text || "";
      const batchData = cleanAndParseJSON(rawText);

      if (!batchData || batchData.length === 0) {
        onProgress("IA não retornou dados estruturados neste lote. Tentando ajustar...");
        // Se falhar o parse, tenta continuar o loop ao invés de quebrar tudo
        if (attempts >= maxLoops) break;
        continue;
      }

      let newCount = 0;
      for (const item of batchData) {
        const normalizedName = (item.name || "").toLowerCase().trim();
        
        if (normalizedName && !seenNames.has(normalizedName)) {
           seenNames.add(normalizedName);
           newCount++;
           
           const address = item.address || "Endereço Desconhecido";
           const name = item.name || "Nome Desconhecido";
           const isSaved = dbService.checkIsProspect(name, address);

           allEntities.push({
            id: `biz-${Date.now()}-${allEntities.length}`,
            name: name,
            address: address,
            phone: item.phone || null,
            website: item.website || null,
            socialLinks: Array.isArray(item.socialLinks) ? item.socialLinks : [],
            lastActivityEvidence: item.lastActivityEvidence || "Sem dados recentes",
            daysSinceLastActivity: typeof item.daysSinceLastActivity === 'number' ? item.daysSinceLastActivity : -1,
            trustScore: typeof item.trustScore === 'number' ? item.trustScore : 50,
            status: (Object.values(BusinessStatus).includes(item.status) ? item.status : BusinessStatus.UNKNOWN) as BusinessStatus,
            category: item.category || (isBroadSearch ? "Diversos" : segment),
            lat: typeof item.lat === 'number' ? item.lat : undefined,
            lng: typeof item.lng === 'number' ? item.lng : undefined,
            isProspect: isSaved,
            pipelineStage: 'new' // Default stage
          });
        }
      }

      // Se a IA começar a rodar em círculos (só duplicatas), paramos.
      if (newCount === 0 && attempts > 1) {
        onProgress("Limite de novidade atingido na região. Encerrando.");
        break;
      }
      
      // Delay tático entre lotes para evitar "Too Many Requests" em bursts longos
      await wait(1000);

    } catch (error: any) {
      console.warn(`Erro fatal no lote ${attempts}:`, error);
      // Se já temos alguns dados, retornamos o que tem. Se não, erro.
      if (allEntities.length > 0) {
        onProgress("Conexão instável, retornando dados parciais...");
        break; 
      }
      throw new Error("Não foi possível conectar à Inteligência Artificial. Verifique sua chave API ou tente novamente em instantes.");
    }
  }

  onProgress(`Processamento concluído. ${allEntities.length} empresas encontradas.`);
  
  // Salva no cache antes de retornar
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
    Evidência: ${business.lastActivityEvidence}
    
    Estrutura:
    1. Assunto (Curto)
    2. Hook (Baseado na evidência ou região)
    3. Proposta de valor sutil
    4. CTA (Pergunta rápida)
    
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
