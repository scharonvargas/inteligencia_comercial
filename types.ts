export enum BusinessStatus {
  VERIFIED = 'Verificado',
  ACTIVE = 'Ativo',
  SUSPICIOUS = 'Suspeito',
  CLOSED = 'Fechado',
  UNKNOWN = 'Desconhecido'
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
  pipelineStage?: string;
  matchType?: 'EXACT' | 'NEARBY'; // Indica se é no local exato ou expansão por proximidade

  // Origem dos dados
  dataSource: 'osm' | 'ai' | 'google' | 'manual';
  verified: boolean; // true = dados reais, false = IA/não verificado

  // Campos de Validação
  cnpj?: string;
  validationStatus?: 'pending' | 'verified' | 'partial' | 'failed';
  validationDetails?: {
    cnpjValid?: boolean;
    phoneValid?: boolean;
    addressValid?: boolean;
    lastValidated?: string;
    cnpjData?: any;
  };

  // Campos de Enriquecimento
  enrichment?: {
    googleRating?: number;
    googleReviewCount?: number;
    companySize?: string; // MEI, ME, EPP, etc
    socialProfiles?: string[];
  };
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