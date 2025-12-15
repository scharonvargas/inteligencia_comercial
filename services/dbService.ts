
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { BusinessEntity, BusinessStatus } from "../types";

// Credenciais fornecidas diretamente para garantir conexão
// Credenciais via variáveis de ambiente (Vite)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

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
  console.warn("Supabase credentials not found. Ensure VITE_SUPABASE_URL and VITE_SUPABASE_KEY are set in .env.");
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
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(prospects));
  } catch (e) {
    console.error("Erro ao salvar no LocalStorage (Quota exceeded?):", e);
    // Em um app real, notificaríamos o usuário ou limparíamos dados antigos
  }
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
  updatePipelineStage: async (businessId: string, newStage: 'new' | 'contacted' | 'meeting' | 'closed' | 'lost'): Promise<void> => {
    if (!supabase) {
      // Fallback Local
      const prospects = await dbService.getAllProspects();
      const prospect = prospects.find(p => p.id === businessId);
      if (prospect) {
        const oldStage = prospect.pipelineStage;
        prospect.pipelineStage = newStage;
        const historyEvent: any = {
          id: crypto.randomUUID(),
          type: 'stage_change',
          description: `Mudou de ${oldStage || 'Novo'} para ${newStage}`,
          createdAt: new Date().toISOString(),
          metadata: { oldStage, newStage }
        };
        prospect.history = [...(prospect.history || []), historyEvent];
        saveLocalProspects(prospects);
      }
      return;
    }

    try {
      // 1. Fetch current history
      const { data: current } = await supabase
        .from('prospects')
        .select('history, pipeline_stage')
        .eq('business_id', businessId) // Using business_id as key
        .single();

      if (!current) throw new Error("Prospect not found in Supabase");

      const oldStage = current.pipeline_stage;
      const historyEvent = {
        id: crypto.randomUUID(),
        type: 'stage_change',
        description: `Mudou de ${oldStage || 'new'} para ${newStage}`,
        createdAt: new Date().toISOString(),
        metadata: { oldStage, newStage }
      };

      // 2. Append to history and Update Stage
      const currentHistory = current.history && Array.isArray(current.history) ? current.history : [];
      const updatedHistory = [...currentHistory, historyEvent];

      const { error } = await supabase
        .from('prospects')
        .update({
          pipeline_stage: newStage,
          history: updatedHistory
        })
        .eq('business_id', businessId);

      if (error) throw error;

    } catch (e: any) {
      console.error("Erro ao atualizar pipeline no Supabase:", e);
      // Opcional: Fallback
    }
  },

  async addNote(businessId: string, content: string, type: 'call' | 'email' | 'note' | 'meeting' = 'note'): Promise<void> {
    if (!supabase) {
      // Fallback Local
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
        saveLocalProspects(prospects);
      }
      return;
    }

    try {
      // 1. Fetch current notes/history
      const { data: current } = await supabase
        .from('prospects')
        .select('notes, history')
        .eq('business_id', businessId)
        .single();

      if (!current) throw new Error("Prospect not found");

      const newNote = {
        id: crypto.randomUUID(),
        content,
        type,
        createdAt: new Date().toISOString()
      };

      const historyEvent = {
        id: crypto.randomUUID(),
        type: 'note_added',
        description: `Nota adicionada: ${content.substring(0, 30)}...`,
        createdAt: new Date().toISOString()
      };

      const currentNotes = current.notes && Array.isArray(current.notes) ? current.notes : [];
      const currentHistory = current.history && Array.isArray(current.history) ? current.history : [];

      const { error } = await supabase
        .from('prospects')
        .update({
          notes: [...currentNotes, newNote],
          history: [...currentHistory, historyEvent]
        })
        .eq('business_id', businessId);

      if (error) throw error;

    } catch (e: any) {
      console.error("Erro ao adicionar nota no Supabase:", e);
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
        pipelineStage: row.pipeline_stage || 'new',
        // Mapping JSONB to Types
        notes: row.notes || [],
        history: row.history || []
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
  },

  /**
   * Verifica cache de busca
   */
  checkCache: async (key: string): Promise<BusinessEntity[] | null> => {
    if (!supabase) return null;
    try {
      const { data, error } = await supabase
        .from('search_cache')
        .select('results, created_at')
        .eq('query_key', key)
        .single();

      if (error || !data) return null;

      // TTL Check (e.g. 24 hours)
      const now = new Date();
      const created = new Date(data.created_at);
      const diffHours = (now.getTime() - created.getTime()) / (1000 * 60 * 60);

      if (diffHours > 24) {
        // Cache expired, delete it async
        supabase.from('search_cache').delete().eq('query_key', key).then();
        return null;
      }

      return data.results as BusinessEntity[];
    } catch (e) {
      console.warn("Cache check failed:", e);
      return null;
    }
  },

  /**
   * Salva resultado no cache
   */
  saveCache: async (key: string, results: BusinessEntity[]) => {
    if (!supabase || results.length === 0) return;
    try {
      await supabase.from('search_cache').upsert({
        query_key: key,
        results: results,
        created_at: new Date().toISOString()
      });
    } catch (e) {
      console.warn("Cache save failed:", e);
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
