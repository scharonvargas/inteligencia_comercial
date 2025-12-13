
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { BusinessEntity, BusinessStatus } from "../types";

// Credenciais fornecidas diretamente para garantir conexão
const supabaseUrl = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || "https://eqqgdlsikdtelwjosxvg.supabase.co";
const supabaseKey = process.env.SUPABASE_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxcWdkbHNpa2R0ZWx3am9zeHZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU0OTM5NzYsImV4cCI6MjA4MTA2OTk3Nn0.555jr7W3mJfuX7Er0v3HWuZ57HFR8Xlo57Yr96ECEys";

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
  updatePipelineStage: async (businessId: string, newStage: string): Promise<void> => {
    if (!supabase) {
      updateLocalStage(businessId, newStage);
      return;
    }

    try {
      const { error } = await supabase
        .from('prospects')
        .update({ pipeline_stage: newStage })
        .eq('business_id', businessId);

      if (error) throw error;
    } catch (error: any) {
      console.error("Erro ao atualizar estágio no Supabase:", error.message || error);
      updateLocalStage(businessId, newStage);
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

function updateLocalStage(businessId: string, newStage: string) {
  const current = getLocalProspects();
  const updated = current.map(p => {
    if (p.id === businessId) return { ...p, pipelineStage: newStage };
    return p;
  });
  saveLocalProspects(updated);
}

// --- Rate Limiting ---
const RATE_LIMIT_KEY = 'vericorp_rate_limit';
const DAILY_SEARCH_LIMIT = 50;

interface RateLimitData {
  count: number;
  date: string;
}

function getLocalRateLimit(): RateLimitData {
  try {
    const saved = localStorage.getItem(RATE_LIMIT_KEY);
    if (saved) {
      const data = JSON.parse(saved);
      const today = new Date().toISOString().split('T')[0];
      // Reset if different day
      if (data.date !== today) {
        return { count: 0, date: today };
      }
      return data;
    }
  } catch { }
  return { count: 0, date: new Date().toISOString().split('T')[0] };
}

function saveLocalRateLimit(data: RateLimitData) {
  localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(data));
}

export const rateLimitService = {
  /**
   * Check if user can perform a search (within daily limit)
   */
  canSearch: async (userId?: string): Promise<{ allowed: boolean; remaining: number; limit: number }> => {
    // For now, use local storage (can be upgraded to Supabase later)
    const data = getLocalRateLimit();
    const remaining = Math.max(0, DAILY_SEARCH_LIMIT - data.count);
    return {
      allowed: data.count < DAILY_SEARCH_LIMIT,
      remaining,
      limit: DAILY_SEARCH_LIMIT
    };
  },

  /**
   * Increment search count after a successful search
   */
  incrementSearchCount: async (userId?: string): Promise<void> => {
    const data = getLocalRateLimit();
    const today = new Date().toISOString().split('T')[0];

    if (data.date !== today) {
      // New day, reset counter
      saveLocalRateLimit({ count: 1, date: today });
    } else {
      saveLocalRateLimit({ count: data.count + 1, date: today });
    }
  },

  /**
   * Get current search count and remaining
   */
  getSearchCount: async (userId?: string): Promise<{ used: number; remaining: number; limit: number }> => {
    const data = getLocalRateLimit();
    const today = new Date().toISOString().split('T')[0];

    // Reset if different day
    if (data.date !== today) {
      return { used: 0, remaining: DAILY_SEARCH_LIMIT, limit: DAILY_SEARCH_LIMIT };
    }

    return {
      used: data.count,
      remaining: Math.max(0, DAILY_SEARCH_LIMIT - data.count),
      limit: DAILY_SEARCH_LIMIT
    };
  }
};

// --- Search History ---
const SEARCH_HISTORY_KEY = 'vericorp_search_history';
const MAX_HISTORY_ITEMS = 20;

export interface SearchHistoryItem {
  id: string;
  segment: string;
  region: string;
  resultsCount: number;
  createdAt: string;
}

function getLocalSearchHistory(): SearchHistoryItem[] {
  try {
    const saved = localStorage.getItem(SEARCH_HISTORY_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function saveLocalSearchHistory(history: SearchHistoryItem[]) {
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY_ITEMS)));
}

export const searchHistoryService = {
  /**
   * Save a new search to history
   */
  saveSearch: async (segment: string, region: string, resultsCount: number): Promise<void> => {
    const history = getLocalSearchHistory();
    const newItem: SearchHistoryItem = {
      id: `search-${Date.now()}`,
      segment: segment || 'Varredura Geral',
      region,
      resultsCount,
      createdAt: new Date().toISOString()
    };
    // Add to beginning, remove duplicates
    const filtered = history.filter(h => !(h.segment === newItem.segment && h.region === newItem.region));
    saveLocalSearchHistory([newItem, ...filtered]);
  },

  /**
   * Get search history
   */
  getHistory: async (limit: number = 10): Promise<SearchHistoryItem[]> => {
    return getLocalSearchHistory().slice(0, limit);
  },

  /**
   * Clear all history
   */
  clearHistory: async (): Promise<void> => {
    localStorage.removeItem(SEARCH_HISTORY_KEY);
  }
};

// --- Lead Lists ---
const LEAD_LISTS_KEY = 'vericorp_lead_lists';
const LEAD_ASSIGNMENTS_KEY = 'vericorp_lead_assignments';

export interface LeadList {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

function getLocalLeadLists(): LeadList[] {
  try {
    const saved = localStorage.getItem(LEAD_LISTS_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function saveLocalLeadLists(lists: LeadList[]) {
  localStorage.setItem(LEAD_LISTS_KEY, JSON.stringify(lists));
}

function getLocalLeadAssignments(): Record<string, string> {
  try {
    const saved = localStorage.getItem(LEAD_ASSIGNMENTS_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function saveLocalLeadAssignments(assignments: Record<string, string>) {
  localStorage.setItem(LEAD_ASSIGNMENTS_KEY, JSON.stringify(assignments));
}

export const leadListService = {
  /**
   * Get all lead lists
   */
  getLists: async (): Promise<LeadList[]> => {
    return getLocalLeadLists();
  },

  /**
   * Create a new list
   */
  createList: async (name: string, color: string = '#6366f1'): Promise<LeadList> => {
    const lists = getLocalLeadLists();
    const newList: LeadList = {
      id: `list-${Date.now()}`,
      name,
      color,
      createdAt: new Date().toISOString()
    };
    saveLocalLeadLists([...lists, newList]);
    return newList;
  },

  /**
   * Delete a list
   */
  deleteList: async (listId: string): Promise<void> => {
    const lists = getLocalLeadLists().filter(l => l.id !== listId);
    saveLocalLeadLists(lists);
    // Also remove assignments
    const assignments = getLocalLeadAssignments();
    for (const key of Object.keys(assignments)) {
      if (assignments[key] === listId) {
        delete assignments[key];
      }
    }
    saveLocalLeadAssignments(assignments);
  },

  /**
   * Assign a lead to a list
   */
  assignToList: async (businessId: string, listId: string | null): Promise<void> => {
    const assignments = getLocalLeadAssignments();
    if (listId === null) {
      delete assignments[businessId];
    } else {
      assignments[businessId] = listId;
    }
    saveLocalLeadAssignments(assignments);
  },

  /**
   * Get list assignment for a business
   */
  getListForBusiness: async (businessId: string): Promise<string | null> => {
    const assignments = getLocalLeadAssignments();
    return assignments[businessId] || null;
  },

  /**
   * Get all assignments
   */
  getAllAssignments: async (): Promise<Record<string, string>> => {
    return getLocalLeadAssignments();
  }
};