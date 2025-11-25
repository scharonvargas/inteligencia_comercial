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