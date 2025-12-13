export enum BusinessStatus {
  VERIFIED = 'Verificado',
  ACTIVE = 'Ativo',
  SUSPICIOUS = 'Suspeito',
  CLOSED = 'Fechado',
  UNKNOWN = 'Desconhecido'
}

export type PipelineStage = 'new' | 'contacted' | 'meeting' | 'closed' | 'lost';

export interface Note {
  id: string;
  content: string;
  createdAt: string; // ISO date
  type?: 'call' | 'email' | 'note' | 'meeting';
}

export interface HistoryEvent {
  id: string;
  type: 'stage_change' | 'note_added' | 'info_updated';
  description: string;
  createdAt: string;
  metadata?: any;
}

export interface BusinessEntity {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  website: string | null;
  socialLinks: string[];
  lastActivityEvidence: string | null; // e.g., "Review from 2 days ago"
  daysSinceLastActivity: number; // -1 if unknown, 0 for today
  trustScore: number; // 0-100
  status: BusinessStatus;
  category: string;
  lat?: number;
  lng?: number;
  isProspect?: boolean; // Novo campo para controle de favoritos
  pipelineStage?: 'new' | 'contacted' | 'meeting' | 'closed' | 'lost';
  matchType?: 'EXACT' | 'NEARBY'; // Indica se é no local exato ou expansão por proximidade
  cnpj?: string | null;
  viabilityScore?: number; // AI Lead Score (0-100)
  viabilityReason?: string; // Motivo do Score
  notes?: Note[];
  history?: HistoryEvent[];
}

export interface SearchParams {
  segment: string;
  region: string;
}

export interface SearchStats {
  totalFound: number;
  verifiedCount: number;
  suspiciousCount: number;
  averageTrustScore: number;
}

export interface OutreachScripts {
  email: string;
  whatsapp: string;
  linkedin: string;
  phoneScript: string;
}

export interface Competitor {
  name: string;
  strengths: string[];
  weaknesses: string[];
  differentiator: string;
}

export interface CompetitorAnalysis {
  competitors: Competitor[];
  marketSummary: string;
}