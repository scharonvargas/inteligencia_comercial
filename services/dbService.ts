
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
   * Uses Supabase if available, otherwise localStorage
   */
  canSearch: async (userId?: string): Promise<{ allowed: boolean; remaining: number; limit: number }> => {
    const today = new Date().toISOString().split('T')[0];

    // Try Supabase first if user is authenticated
    if (supabase && userId) {
      try {
        const { data, error } = await supabase
          .from('rate_limits')
          .select('search_count')
          .eq('user_id', userId)
          .eq('reset_date', today)
          .single();

        if (!error && data) {
          const remaining = Math.max(0, DAILY_SEARCH_LIMIT - data.search_count);
          return { allowed: data.search_count < DAILY_SEARCH_LIMIT, remaining, limit: DAILY_SEARCH_LIMIT };
        }
        // No record for today means 0 searches
        return { allowed: true, remaining: DAILY_SEARCH_LIMIT, limit: DAILY_SEARCH_LIMIT };
      } catch {
        // Fallback to localStorage
      }
    }

    // Fallback: localStorage
    const localData = getLocalRateLimit();
    if (localData.date !== today) {
      return { allowed: true, remaining: DAILY_SEARCH_LIMIT, limit: DAILY_SEARCH_LIMIT };
    }
    const remaining = Math.max(0, DAILY_SEARCH_LIMIT - localData.count);
    return { allowed: localData.count < DAILY_SEARCH_LIMIT, remaining, limit: DAILY_SEARCH_LIMIT };
  },

  /**
   * Increment search count after a successful search
   */
  incrementSearchCount: async (userId?: string): Promise<void> => {
    const today = new Date().toISOString().split('T')[0];

    // Try Supabase first
    if (supabase && userId) {
      try {
        const { data: existing } = await supabase
          .from('rate_limits')
          .select('id, search_count')
          .eq('user_id', userId)
          .eq('reset_date', today)
          .single();

        if (existing) {
          await supabase
            .from('rate_limits')
            .update({ search_count: existing.search_count + 1 })
            .eq('id', existing.id);
        } else {
          await supabase
            .from('rate_limits')
            .insert({ user_id: userId, search_count: 1, reset_date: today });
        }
        return;
      } catch {
        // Fallback to localStorage
      }
    }

    // Fallback: localStorage
    const localData = getLocalRateLimit();
    if (localData.date !== today) {
      saveLocalRateLimit({ count: 1, date: today });
    } else {
      saveLocalRateLimit({ count: localData.count + 1, date: today });
    }
  },

  /**
   * Get current search count and remaining
   */
  getSearchCount: async (userId?: string): Promise<{ used: number; remaining: number; limit: number }> => {
    const today = new Date().toISOString().split('T')[0];

    // Try Supabase first
    if (supabase && userId) {
      try {
        const { data } = await supabase
          .from('rate_limits')
          .select('search_count')
          .eq('user_id', userId)
          .eq('reset_date', today)
          .single();

        if (data) {
          return {
            used: data.search_count,
            remaining: Math.max(0, DAILY_SEARCH_LIMIT - data.search_count),
            limit: DAILY_SEARCH_LIMIT
          };
        }
        return { used: 0, remaining: DAILY_SEARCH_LIMIT, limit: DAILY_SEARCH_LIMIT };
      } catch {
        // Fallback
      }
    }

    // Fallback: localStorage
    const localData = getLocalRateLimit();
    if (localData.date !== today) {
      return { used: 0, remaining: DAILY_SEARCH_LIMIT, limit: DAILY_SEARCH_LIMIT };
    }
    return {
      used: localData.count,
      remaining: Math.max(0, DAILY_SEARCH_LIMIT - localData.count),
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

// --- Message Templates ---
const TEMPLATES_KEY = 'vericorp_templates';

export interface MessageTemplate {
  id: string;
  name: string;
  content: string;
  type: 'whatsapp' | 'email';
  createdAt: string;
}

function getLocalTemplates(): MessageTemplate[] {
  try {
    const saved = localStorage.getItem(TEMPLATES_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function saveLocalTemplates(templates: MessageTemplate[]) {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
}

export const templateService = {
  /**
   * Get all templates
   */
  getTemplates: async (): Promise<MessageTemplate[]> => {
    return getLocalTemplates();
  },

  /**
   * Create a new template
   */
  createTemplate: async (name: string, content: string, type: 'whatsapp' | 'email'): Promise<MessageTemplate> => {
    const templates = getLocalTemplates();
    const newTemplate: MessageTemplate = {
      id: `tpl-${Date.now()}`,
      name,
      content,
      type,
      createdAt: new Date().toISOString()
    };
    saveLocalTemplates([...templates, newTemplate]);
    return newTemplate;
  },

  /**
   * Update a template
   */
  updateTemplate: async (id: string, updates: Partial<MessageTemplate>): Promise<void> => {
    const templates = getLocalTemplates().map(t =>
      t.id === id ? { ...t, ...updates } : t
    );
    saveLocalTemplates(templates);
  },

  /**
   * Delete a template
   */
  deleteTemplate: async (id: string): Promise<void> => {
    const templates = getLocalTemplates().filter(t => t.id !== id);
    saveLocalTemplates(templates);
  },

  /**
   * Apply template variables
   * Variables: {{nome}}, {{empresa}}, {{telefone}}, {{endereco}}, {{categoria}}
   */
  applyVariables: (template: string, business: { name?: string; phone?: string; address?: string; category?: string }): string => {
    return template
      .replace(/\{\{nome\}\}/gi, business.name || '')
      .replace(/\{\{empresa\}\}/gi, business.name || '')
      .replace(/\{\{telefone\}\}/gi, business.phone || '')
      .replace(/\{\{endereco\}\}/gi, business.address || '')
      .replace(/\{\{categoria\}\}/gi, business.category || '');
  }
};

// --- Lead Scoring ---
const LEAD_SCORES_KEY = 'vericorp_lead_scores';

export interface LeadScore {
  businessId: string;
  score: number; // 0-100
  factors: {
    hasPhone: boolean;
    hasWebsite: boolean;
    hasAddress: boolean;
    categoryRelevance: number;
    recentActivity: boolean;
  };
  calculatedAt: string;
}

function getLocalLeadScores(): Record<string, LeadScore> {
  try {
    const saved = localStorage.getItem(LEAD_SCORES_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function saveLocalLeadScores(scores: Record<string, LeadScore>) {
  localStorage.setItem(LEAD_SCORES_KEY, JSON.stringify(scores));
}

export const leadScoreService = {
  /**
   * Calculate and store lead score for a business
   */
  calculateScore: (business: {
    id: string;
    name: string;
    phone?: string | null;
    website?: string | null;
    address?: string;
    category?: string;
    description?: string;
  }): LeadScore => {
    let score = 0;
    const factors = {
      hasPhone: false,
      hasWebsite: false,
      hasAddress: false,
      categoryRelevance: 0,
      recentActivity: false
    };

    // Phone: +20 points
    if (business.phone && business.phone.length > 8) {
      score += 20;
      factors.hasPhone = true;
    }

    // Website: +25 points
    if (business.website && business.website.includes('.')) {
      score += 25;
      factors.hasWebsite = true;
    }

    // Address: +15 points
    if (business.address && business.address.length > 10) {
      score += 15;
      factors.hasAddress = true;
    }

    // Category relevance: +20 points (based on specificity)
    if (business.category) {
      const categoryScore = Math.min(20, business.category.length / 2);
      score += categoryScore;
      factors.categoryRelevance = categoryScore;
    }

    // Description/Activity: +20 points
    if (business.description && business.description.length > 50) {
      score += 20;
      factors.recentActivity = true;
    }

    const leadScore: LeadScore = {
      businessId: business.id,
      score: Math.min(100, Math.round(score)),
      factors,
      calculatedAt: new Date().toISOString()
    };

    // Save to local storage
    const scores = getLocalLeadScores();
    scores[business.id] = leadScore;
    saveLocalLeadScores(scores);

    return leadScore;
  },

  /**
   * Get cached score for a business
   */
  getScore: (businessId: string): LeadScore | null => {
    const scores = getLocalLeadScores();
    return scores[businessId] || null;
  },

  /**
   * Get score label and color
   */
  getScoreLabel: (score: number): { label: string; color: string; emoji: string } => {
    if (score >= 80) return { label: 'Quente', color: 'text-red-400', emoji: '🔥' };
    if (score >= 60) return { label: 'Morno', color: 'text-amber-400', emoji: '🌡️' };
    if (score >= 40) return { label: 'Potencial', color: 'text-yellow-400', emoji: '💡' };
    return { label: 'Frio', color: 'text-blue-400', emoji: '❄️' };
  },

  /**
   * Batch calculate scores
   */
  calculateBatch: (businesses: any[]): void => {
    businesses.forEach(b => leadScoreService.calculateScore(b));
  }
};

// --- CNPJ Enrichment Service ---
export interface CNPJEnrichmentData {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  situacao: string;
  dataAbertura: string;
  porte: string;
  capitalSocial: string;
  atividadePrincipal: string;
  telefone: string;
  email: string;
  endereco: string;
  socios: { nome: string; cargo: string }[];
}

export const cnpjService = {
  /**
   * Enrich business data with CNPJ information
   */
  enrich: async (cnpj: string): Promise<CNPJEnrichmentData | null> => {
    try {
      const response = await fetch(`/api/cnpj?cnpj=${encodeURIComponent(cnpj)}`);

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const data = await response.json();

      return {
        cnpj: data.cnpj,
        razaoSocial: data.razaoSocial,
        nomeFantasia: data.nomeFantasia,
        situacao: data.situacao,
        dataAbertura: data.dataAbertura,
        porte: data.porte,
        capitalSocial: data.capitalSocial,
        atividadePrincipal: data.atividadePrincipal,
        telefone: data.telefone,
        email: data.email,
        endereco: `${data.logradouro}, ${data.numero} - ${data.bairro}, ${data.municipio}/${data.uf}`,
        socios: (data.qsa || []).map((s: any) => ({ nome: s.nome, cargo: s.qual }))
      };
    } catch (error) {
      console.error('CNPJ Enrichment Error:', error);
      return null;
    }
  },

  /**
   * Extract CNPJ from text (if present)
   */
  extractCNPJ: (text: string): string | null => {
    // Match CNPJ patterns: XX.XXX.XXX/XXXX-XX or just 14 digits
    const patterns = [
      /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/,
      /\d{14}/
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[0].replace(/[^\d]/g, '');
    }
    return null;
  }
};