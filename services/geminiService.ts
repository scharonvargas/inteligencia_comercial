import { GoogleGenAI } from "@google/genai";
import { BusinessEntity, BusinessStatus } from "../types";
import { dbService } from "./dbService";

const apiKey = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

/**
 * Parses the raw text response from Gemini to extract the JSON array.
 */
function extractJson(text: string): any[] {
  try {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
      return JSON.parse(match[1]);
    }
    const arrayMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (arrayMatch) {
      return JSON.parse(arrayMatch[0]);
    }
    throw new Error("Nenhum JSON encontrado");
  } catch (e) {
    console.error("Falha ao analisar JSON da resposta Gemini:", e);
    return [];
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

  const BATCH_SIZE = 20; // Gemini processa melhor em lotes menores
  const allEntities: BusinessEntity[] = [];
  const seenNames = new Set<string>();
  let attempts = 0;
  const maxAttempts = Math.ceil(maxResults / BATCH_SIZE) + 2; // Margem de segurança

  // Detecta se é varredura (segmento genérico ou vazio enviado pelo App.tsx)
  const isBroadSearch = segment === "Varredura Geral (Multisetorial)" || segment === "";

  onProgress(`Inicializando ${isBroadSearch ? 'varredura geográfica ampla' : 'busca segmentada'} para meta de ${maxResults} empresas...`);
  
  const modelId = "gemini-2.5-flash";

  while (allEntities.length < maxResults && attempts < maxAttempts) {
    attempts++;
    const remaining = maxResults - allEntities.length;
    const currentBatchSize = Math.min(BATCH_SIZE, remaining);
    
    // Lista de exclusão para evitar duplicatas
    const exclusionList = Array.from(seenNames).slice(-50).join(", "); // Limita contexto aos ultimos 50 nomes

    onProgress(`Executando varredura ${attempts}: Buscando ${currentBatchSize} novas empresas (Total acumulado: ${allEntities.length})...`);

    // Construção do Prompt Dinâmico
    let promptTask = "";
    if (isBroadSearch) {
      promptTask = `
        1. REALIZE UMA VARREDURA GEOGRÁFICA na área: "${region}".
        2. Encontre EXATAMENTE ${currentBatchSize} empresas de DIVERSOS SETORES (Mix de Comércio, Serviços, Escritórios, Indústria).
        3. FOCO: Priorize aglomerados comerciais, prédios corporativos e lojas de rua nesta região.
        4. IMPORTANTE: NÃO repita estas empresas já listadas: [${exclusionList}].
      `;
    } else {
      promptTask = `
        1. Pesquise por empresas especificamente do segmento "${segment}" em "${region}".
        2. Encontre EXATAMENTE ${currentBatchSize} NOVOS candidatos potenciais.
        3. IMPORTANTE: NÃO inclua estas empresas que já encontrei: [${exclusionList}].
      `;
    }

    const prompt = `
      Atue como um agente rigoroso de Business Intelligence e Mapeamento de Território.
      
      TAREFA:
      ${promptTask}
      4. ANALISE cada candidato buscando sinais de atividade legítima e recente.
      5. FILTRE E EXCLUA: Negócios fechados definitivamente ou residenciais puros.
      6. CLASSIFIQUE corretamente a categoria de cada um (não use "Geral", seja específico, ex: "Escritório de Advocacia", "Padaria", "Consultoria TI").
      
      FORMATO DE SAÍDA:
      Retorne estritamente um array JSON válido (sem comentários) dentro de um bloco markdown.
      ESTIME AS COORDENADAS (Latitude/Longitude) baseadas no endereço encontrado para plotagem em mapa.
      
      Estrutura:
      {
        "name": "string",
        "address": "string",
        "phone": "string ou null",
        "website": "string ou null",
        "socialLinks": ["string"],
        "lastActivityEvidence": "string (ex: 'Avaliação Google 2 dias atrás')",
        "daysSinceLastActivity": number (estimativa em dias, -1 se desconhecido),
        "trustScore": number (0-100),
        "category": "string (Seja específico)",
        "status": "Verificado" | "Ativo" | "Suspeito" | "Fechado" | "Desconhecido",
        "lat": number,
        "lng": number
      }
    `;

    try {
      const response = await ai.models.generateContent({
        model: modelId,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          temperature: isBroadSearch ? 0.7 : 0.5, // Maior temperatura na varredura para garantir diversidade
        },
      });

      const rawText = response.text || "";
      const batchData = extractJson(rawText);

      if (!batchData || batchData.length === 0) {
        onProgress("Nenhum novo resultado encontrado neste lote. Finalizando busca.");
        break;
      }

      let newCount = 0;
      for (const item of batchData) {
        // Normalização simples para verificação de duplicidade
        const normalizedName = (item.name || "").toLowerCase().trim();
        
        if (normalizedName && !seenNames.has(normalizedName)) {
           seenNames.add(normalizedName);
           newCount++;
           
           const address = item.address || "Endereço Desconhecido";
           const name = item.name || "Nome Desconhecido";
           
           // Verifica se já é um prospect salvo no DB local
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
            trustScore: typeof item.trustScore === 'number' ? item.trustScore : 0,
            status: (Object.values(BusinessStatus).includes(item.status) ? item.status : BusinessStatus.UNKNOWN) as BusinessStatus,
            category: item.category || (isBroadSearch ? "Diversos" : segment),
            lat: typeof item.lat === 'number' ? item.lat : undefined,
            lng: typeof item.lng === 'number' ? item.lng : undefined,
            isProspect: isSaved
          });
        }
      }

      if (newCount === 0) {
        onProgress("A IA retornou apenas duplicatas. Encerrando busca antecipadamente.");
        break;
      }
      
      // Delay pequeno para evitar rate limit agressivo se necessário
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error: any) {
      console.warn(`Erro no lote ${attempts}:`, error);
      // Não lança erro fatal, tenta continuar ou retornar o que tem
      if (allEntities.length > 0) break; 
      throw new Error(error.message || "Falha ao buscar dados.");
    }
  }

  onProgress(`Processamento concluído. ${allEntities.length} empresas encontradas.`);
  return allEntities;
};

export const generateOutreachEmail = async (business: BusinessEntity): Promise<string> => {
  if (!apiKey) {
    throw new Error("Chave API não configurada.");
  }

  const prompt = `
    Atue como um especialista em Copywriting B2B e Vendas Consultivas.
    Escreva um "Cold Email" (e-mail de prospecção) curto, personalizado e altamente persuasivo para a empresa abaixo.
    
    Dados do Prospect:
    - Empresa: ${business.name}
    - Segmento: ${business.category}
    - Evidência Recente: ${business.lastActivityEvidence || "Não especificada"}
    - Site: ${business.website || "Sem site"}
    
    Estrutura do E-mail:
    1. Assunto: Curto, intrigante e relevante para o negócio deles.
    2. Abertura (Hook): Mencione a evidência encontrada ou o contexto da região para mostrar que não é spam.
    3. Corpo: Sugira sutilmente uma parceria ou melhoria digital (ex: tráfego pago, SEO, software de gestão) relevante para ${business.category}.
    4. Call to Action (CTA): Uma pergunta de baixo atrito para iniciar conversa (ex: "Podemos conversar 5 min?").
    
    Regras de Tom:
    - Profissional, mas acessível.
    - Português do Brasil.
    - Sem exageros de marketing.
    
    Retorne APENAS o texto plano do e-mail, formatado com:
    Assunto: ...
    
    [Corpo do e-mail]
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    return response.text || "Não foi possível gerar o e-mail.";
  } catch (error) {
    console.error("Erro na geração de e-mail:", error);
    return "Erro ao conectar com a IA para gerar o e-mail.";
  }
};