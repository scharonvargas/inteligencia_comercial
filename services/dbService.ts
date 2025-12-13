
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { BusinessEntity, BusinessStatus } from "../types";

// Credenciais fornecidas diretamente para garantir conexão
const supabaseUrl = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;

let supabase: SupabaseClient | null = null;

// Inicialização segura
if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log("Supabase inicializado com sucesso.");
  } catch (error) {
    console.error("Erro ao inicializar Supabase:", error);
  }
} else {
  console.warn("Supabase credentials not found. Using local storage fallback.");
}

// --- Fallback Functions (LocalStorage) ---
const LOCAL_STORAGE_KEY = 'vericorp_prospects_backup';

const getLocalProspects = (): BusinessEntity[] => {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

const saveLocalProspects = (prospects: BusinessEntity[]) => {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(prospects));
};

export const dbService = {
  /**
   * Verifica se o Supabase está configurado e ativo
   */
  isConfigured: () => {
    return !!supabase;
  },

  /**
   * Testa a conexão com o banco de dados
   */
  testConnection: async (): Promise<boolean> => {
    if (!supabase) return false;
    try {
      // Usar count: exact para verificar acesso à tabela
      const { count, error } = await supabase.from('prospects').select('*', { count: 'exact', head: true });
      if (error) {
        console.warn("Falha no teste de conexão (Tabela ou Permissão):", error.message || error);
        return false;
      }
      return true;
    } catch (e: any) {
      console.warn("Erro de rede ou cliente Supabase:", e.message || e);
      return false;
    }
  },

  /**
   * Salva ou remove um prospect
   */
  toggleProspect: async (business: BusinessEntity): Promise<boolean> => {
    // 1. Fallback para LocalStorage se Supabase estiver off ou falhar
    if (!supabase) {
      return toggleLocal(business);
    }

    // 2. Lógica Supabase
    try {
      // Verifica se já existe baseado no nome e endereço (chave composta lógica)
      const { data: existing, error: searchError } = await supabase
        .from('prospects')
        .select('id')
        .eq('name', business.name)
        .eq('address', business.address)
        .maybeSingle();

      if (searchError) {
        console.warn("Erro ao buscar no Supabase (searchError):", searchError.message || searchError);
        return toggleLocal(business);
      }

      if (existing) {
        // Remover
        const { error: deleteError } = await supabase
          .from('prospects')
          .delete()
          .eq('id', existing.id);

        if (deleteError) throw deleteError;
        return false; // Não é mais prospect
      } else {
        // Adicionar
        const payload = {
          business_id: business.id,
          name: business.name,
          address: business.address,
          phone: business.phone,
          website: business.website,
          social_links: business.socialLinks,
          last_activity_evidence: business.lastActivityEvidence,
          days_since_last_activity: business.daysSinceLastActivity,
          trust_score: business.trustScore,
          status: business.status,
          category: business.category,
          lat: business.lat,
          lng: business.lng,
          pipeline_stage: business.pipelineStage || 'new'
        };

        const { error: insertError } = await supabase
          .from('prospects')
          .insert([payload]);

        if (insertError) throw insertError;
        return true; // É prospect
      }
    } catch (error: any) {
      console.error("Erro ao alternar prospect no Supabase:", error.message || error);
      return toggleLocal(business); // Fallback silencioso em caso de erro de rede
    }
  },

  /**
   * Atualiza o estágio do pipeline de um lead
   */
  /**
   * Atualiza o estágio do pipeline de um lead
   */
  updatePipelineStage: async (businessId: string, newStage: 'new' | 'contacted' | 'meeting' | 'closed' | 'lost'): Promise<void> => {
    // 1. Atualizar Local Storage (Supabase fallback logic kept simple for now)
    const prospects = await dbService.getAllProspects();
    const prospect = prospects.find(p => p.id === businessId);

    if (prospect) {
      const oldStage = prospect.pipelineStage;
      prospect.pipelineStage = newStage;

      // Log history event
      const historyEvent: any = {
        id: crypto.randomUUID(),
        type: 'stage_change',
        description: `Mudou de ${oldStage || 'Novo'} para ${newStage}`,
        createdAt: new Date().toISOString(),
        metadata: { oldStage, newStage }
      };

      prospect.history = [...(prospect.history || []), historyEvent];

      await saveLocalProspects(prospects);
    }
  },

  async addNote(businessId: string, content: string, type: 'call' | 'email' | 'note' | 'meeting' = 'note'): Promise<void> {
    const prospects = await dbService.getAllProspects();
    const prospect = prospects.find(p => p.id === businessId);

    if (prospect) {
      const newNote: any = {
        id: crypto.randomUUID(),
        content,
        type,
        createdAt: new Date().toISOString()
      };

      const historyEvent: any = {
        id: crypto.randomUUID(),
        type: 'note_added',
        description: `Nota adicionada: ${content.substring(0, 30)}${content.length > 30 ? '...' : ''}`,
        createdAt: new Date().toISOString()
      };

      prospect.notes = [...(prospect.notes || []), newNote];
      prospect.history = [...(prospect.history || []), historyEvent];

      await saveLocalProspects(prospects);
    }
  },

  /**
   * Retorna todos os prospects salvos
   */
  getAllProspects: async (): Promise<BusinessEntity[]> => {
    if (!supabase) {
      return getLocalProspects();
    }

    try {
      const { data, error } = await supabase
        .from('prospects')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []).map((row: any) => ({
        id: row.business_id || String(row.id),
        name: row.name,
        address: row.address,
        phone: row.phone,
        website: row.website,
        socialLinks: row.social_links || [],
        lastActivityEvidence: row.last_activity_evidence,
        daysSinceLastActivity: row.days_since_last_activity,
        trustScore: row.trust_score,
        status: row.status as BusinessStatus,
        category: row.category,
        lat: row.lat,
        lng: row.lng,
        isProspect: true,
        pipelineStage: row.pipeline_stage || 'new'
      }));
    } catch (error: any) {
      // Improved error logging
      const errMsg = error.message || JSON.stringify(error, null, 2);
      console.error("Erro ao buscar prospects do Supabase, tentando local:", errMsg);

      // Hint for missing table
      if (errMsg.includes("relation") && errMsg.includes("does not exist")) {
        console.info("%c⚠️ A tabela 'prospects' não existe no Supabase. Crie-a usando o SQL fornecido.", "color: orange; font-weight: bold;");
      }

      return getLocalProspects();
    }
  }
};

// Helpers Locais
function toggleLocal(business: BusinessEntity): boolean {
  const current = getLocalProspects();
  const exists = current.find(p => p.id === business.id || (p.name === business.name && p.address === business.address));

  if (exists) {
    const filtered = current.filter(p => p.id !== exists.id);
    saveLocalProspects(filtered);
    return false;
  } else {
    saveLocalProspects([...current, { ...business, isProspect: true }]);
    return true;
  }
}

