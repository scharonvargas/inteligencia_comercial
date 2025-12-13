import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as ReactWindow from 'react-window';
import { BusinessEntity, BusinessStatus } from '../types';
import { generateOutreachEmail } from '../services/geminiService';
import { dbService, leadScoreService } from '../services/dbService';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import {
  ExternalLink, Phone, Globe, AlertTriangle, CheckCircle, Download,
  Activity, ChevronDown, ChevronUp, Calendar, Instagram, Facebook, Linkedin,
  Mail, Sparkles, Copy, Loader2, Check, Star, MessageCircle, MapPin, Target, X, Filter, Share2
} from 'lucide-react';

// Workaround for react-window import in ESM/CDN environments
// Tries multiple export locations for VariableSizeList
const List = ReactWindow.VariableSizeList ||
  (ReactWindow as any).default?.VariableSizeList ||
  (ReactWindow as any).default ||
  (window as any).ReactWindow?.VariableSizeList;

// --- Leaflet Icon Fix ---
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface ResultsTableProps {
  data: BusinessEntity[];
}

type ActivityFilter = 'all' | '30days' | '90days' | 'custom';
type LocationFilter = 'all' | 'exact';

// --- Constants & Styles ---
const ROW_HEIGHT = 76; // Altura da linha contraída
const EXPANDED_CONTENT_HEIGHT = 500; // Altura aproximada do conteúdo expandido
const GRID_TEMPLATE = "50px 50px minmax(200px, 1.5fr) 120px 140px 140px 80px"; // Definição das colunas

// --- Helpers ---

const getStatusColor = (status: BusinessStatus) => {
  switch (status) {
    case BusinessStatus.VERIFIED: return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50';
    case BusinessStatus.ACTIVE: return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
    case BusinessStatus.SUSPICIOUS: return 'bg-amber-500/20 text-amber-400 border-amber-500/50';
    case BusinessStatus.CLOSED: return 'bg-red-500/20 text-red-400 border-red-500/50';
    default: return 'bg-slate-500/20 text-slate-400 border-slate-500/50';
  }
};

const getSocialIcon = (url: string) => {
  if (!url) return <ExternalLink size={16} />;
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('instagram')) return <Instagram size={16} />;
  if (lowerUrl.includes('facebook')) return <Facebook size={16} />;
  if (lowerUrl.includes('linkedin')) return <Linkedin size={16} />;
  if (lowerUrl.includes('wa.me') || lowerUrl.includes('whatsapp')) return <MessageCircle size={16} />;
  return <ExternalLink size={16} />;
};

const getHostname = (url: string) => {
  try {
    if (!url) return '';
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url || '';
  }
};

const createWhatsAppUrl = (phone: string | null, name: string) => {
  if (!phone) return '#';
  // Remove non-digits
  let clean = phone.replace(/\D/g, '');
  // Remove leading zeros
  clean = clean.replace(/^0+/, '');

  if (clean.length === 0) return '#';

  // Heurística simples para Brasil: se tiver 10 ou 11 dígitos, assume que falta o 55
  if (clean.length >= 10 && clean.length <= 11) {
    clean = '55' + clean;
  }

  const text = encodeURIComponent(`Olá, encontrei a ${name} e gostaria de saber mais sobre seus serviços.`);
  return `https://wa.me/${clean}?text=${text}`;
};

// --- Hooks ---

// Hook simples para monitorar tamanho do container (substituto leve para AutoSizer)
const useContainerSize = (ref: React.RefObject<HTMLDivElement>) => {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!ref.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    resizeObserver.observe(ref.current);
    return () => resizeObserver.disconnect();
  }, [ref]);

  return size;
};

// --- Sub-components ---

const LocationModal = ({ biz, onClose }: { biz: BusinessEntity, onClose: () => void }) => {
  if (!biz.lat || !biz.lng) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-fadeIn" onClick={onClose}>
      <div className="bg-slate-800 w-full max-w-lg rounded-xl border border-slate-700 shadow-2xl overflow-hidden relative" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 bg-slate-900/50 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <MapPin className="text-brand-500" size={20} />
            <h3 className="text-slate-100 font-bold">{biz.name}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 hover:bg-slate-700 rounded-full">
            <X size={20} />
          </button>
        </div>
        <div className="h-64 w-full relative z-0">
          <MapContainer
            center={[biz.lat, biz.lng]}
            zoom={16}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={[biz.lat, biz.lng]}>
              <Popup>
                <div className="text-slate-800 font-sans text-sm">
                  <strong>{biz.name}</strong><br />
                  {biz.address}
                </div>
              </Popup>
            </Marker>
          </MapContainer>
        </div>
        <div className="p-4 bg-slate-800 text-sm">
          <p className="text-slate-300 mb-2 flex items-start gap-2">
            <MapPin size={16} className="shrink-0 mt-0.5 text-slate-500" />
            {biz.address}
          </p>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${biz.lat},${biz.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-brand-400 hover:text-brand-300 hover:underline text-xs"
          >
            Abrir no Google Maps <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </div>
  );
};

// --- Virtualized Row Component ---
interface VirtualRowProps {
  index: number;
  style: React.CSSProperties;
  data: {
    items: BusinessEntity[];
    expandedRowId: string | null;
    toggleRow: (id: string) => void;
    onToggleProspect: (e: React.MouseEvent, biz: BusinessEntity) => void;
    onGenerateEmail: (biz: BusinessEntity) => void;
    generatedEmails: Record<string, string>;
    loadingEmailId: string | null;
    onCopyEmail: (text: string, id: string) => void;
    copiedEmailId: string | null;
    onViewMap: (biz: BusinessEntity) => void;
  }
}

const VirtualRow = ({ index, style, data }: VirtualRowProps) => {
  const biz = data.items[index];
  const isExpanded = data.expandedRowId === biz.id;
  const { toggleRow, onToggleProspect, onGenerateEmail, generatedEmails, loadingEmailId, onCopyEmail, copiedEmailId, onViewMap } = data;

  const generatedEmail = generatedEmails[biz.id];
  const loadingEmail = loadingEmailId === biz.id;

  const waUrl = biz.phone ? createWhatsAppUrl(biz.phone, biz.name) : '#';

  return (
    <div style={style} className="px-2">
      {/* Card Wrapper for Row */}
      <div className={`transition-all duration-300 border-b border-slate-700/50 ${isExpanded ? 'bg-slate-700/20' : 'hover:bg-slate-700/10'}`}>

        {/* Main Grid Row */}
        <div
          onClick={() => toggleRow(biz.id)}
          className="grid items-center gap-4 py-4 px-2 cursor-pointer"
          style={{ gridTemplateColumns: GRID_TEMPLATE }}
        >
          {/* 1. Chevron */}
          <div className="flex justify-center text-slate-500">
            {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </div>

          {/* 2. Star */}
          <div className="flex justify-center">
            <button
              onClick={(e) => onToggleProspect(e, biz)}
              className="hover:scale-110 transition-transform p-1 rounded-full hover:bg-slate-600 focus:outline-none"
            >
              <Star
                size={18}
                className={biz.isProspect ? "fill-amber-400 text-amber-400" : "text-slate-600 hover:text-slate-500"}
              />
            </button>
          </div>

          {/* 3. Company Info */}
          <div className="overflow-hidden">
            <div className="flex items-center gap-2">
              {/* Lead Score Badge */}
              {(() => {
                const scoreData = leadScoreService.calculateScore(biz);
                const label = leadScoreService.getScoreLabel(scoreData.score);
                return (
                  <span
                    className={`text-xs ${label.color} shrink-0`}
                    title={`Score: ${scoreData.score}/100`}
                  >
                    {label.emoji}
                  </span>
                );
              })()}
              <div className="font-bold text-slate-200 truncate" title={biz.name}>{biz.name}</div>
              {biz.matchType === 'NEARBY' && (
                <span className="shrink-0 text-[10px] uppercase font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 flex items-center gap-1" title="Região Próxima">
                  <AlertTriangle size={8} /> <span className="hidden sm:inline">Próximo</span>
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500 truncate mt-0.5">{biz.category}</div>
          </div>

          {/* 4. Status */}
          <div>
            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${getStatusColor(biz.status)}`}>
              {biz.status === BusinessStatus.VERIFIED && <CheckCircle size={10} />}
              {biz.status === BusinessStatus.SUSPICIOUS && <AlertTriangle size={10} />}
              {biz.status}
            </span>
          </div>

          {/* 5. Contact */}
          <div className="flex flex-col gap-1 text-xs text-slate-300">
            {biz.phone ? (
              <div className="flex items-center gap-2 group/phone">
                <Phone size={12} className="text-slate-500 shrink-0" />
                <span className="truncate">{biz.phone}</span>
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  className="opacity-0 group-hover/phone:opacity-100 transition-opacity text-emerald-400 hover:text-emerald-300 bg-emerald-900/30 p-1 rounded-full"
                  title="Abrir WhatsApp"
                >
                  <MessageCircle size={12} />
                </a>
              </div>
            ) : <span className="text-slate-600">Sem telefone</span>}
          </div>

          {/* 6. Activity */}
          <div className="flex items-center gap-2 overflow-hidden">
            <Activity size={14} className={biz.daysSinceLastActivity <= 30 && biz.daysSinceLastActivity !== -1 ? "text-emerald-400 shrink-0" : "text-slate-500 shrink-0"} />
            <span className="text-xs text-slate-300 truncate">
              {biz.daysSinceLastActivity === 0
                ? 'Hoje'
                : biz.daysSinceLastActivity > 0
                  ? `${biz.daysSinceLastActivity} dias atrás`
                  : 'Desconhecido'}
            </span>
          </div>

          {/* 7. Score */}
          <div className="text-right pr-4">
            <div className="inline-flex items-center justify-center gap-2 bg-slate-900/50 px-2 py-1 rounded w-full max-w-[60px] ml-auto">
              <div className={`w-2 h-2 rounded-full shrink-0 ${biz.trustScore > 75 ? 'bg-emerald-500' : biz.trustScore > 40 ? 'bg-amber-500' : 'bg-red-500'}`} />
              <span className="text-xs font-mono font-bold text-slate-300">{biz.trustScore}</span>
            </div>
          </div>
        </div>

        {/* Expanded Content */}
        {isExpanded && (
          <div className="px-14 pb-6 pt-2 cursor-default animate-fadeIn">
            <div className="p-6 border-l-2 border-brand-500 bg-slate-800/50 rounded-r-lg grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* Col 1: Activity & Location */}
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-bold text-brand-400 uppercase tracking-wide mb-2 flex items-center gap-2">
                    <Activity size={14} /> Detalhes de Atividade
                  </h4>
                  <div className="text-sm text-slate-300 bg-slate-900/50 p-3 rounded border border-slate-700/50 leading-relaxed">
                    "{biz.lastActivityEvidence || "Nenhuma evidência textual encontrada."}"
                  </div>
                </div>
                <div>
                  <h4 className="text-xs font-bold text-brand-400 uppercase tracking-wide mb-2 flex items-center gap-2">
                    <MapPin size={14} /> Localização
                  </h4>
                  <p className="text-sm text-slate-300 mb-2">{biz.address}</p>
                  {biz.lat && biz.lng && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onViewMap(biz); }}
                      className="flex items-center gap-1.5 text-xs font-medium text-brand-400 hover:text-brand-300 hover:underline bg-brand-900/20 px-2 py-1 rounded border border-brand-500/20"
                    >
                      <MapPin size={12} />
                      Ver no Mapa
                    </button>
                  )}
                  {biz.matchType === 'NEARBY' && (
                    <p className="text-amber-500 mt-2 text-xs italic flex items-center gap-1 bg-amber-500/10 p-1.5 rounded border border-amber-500/20">
                      <AlertTriangle size={10} />
                      Localizado em região próxima (Fora do alvo exato)
                    </p>
                  )}
                </div>
              </div>

              {/* Col 2: Digital Presence */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-brand-400 uppercase tracking-wide flex items-center gap-2">
                  <Globe size={14} /> Presença Digital
                </h4>
                <div className="space-y-2">

                  {/* Botão de WhatsApp de Destaque */}
                  {biz.phone && (
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white p-2.5 rounded font-bold text-xs transition-colors shadow-lg shadow-emerald-500/20 mb-3"
                    >
                      <MessageCircle size={16} />
                      Iniciar Conversa no WhatsApp
                    </a>
                  )}

                  {biz.website ? (
                    <div className="flex items-center justify-between bg-slate-900 p-2 rounded border border-slate-700">
                      <div className="flex items-center gap-2 truncate">
                        <Globe size={14} className="text-slate-500" />
                        <span className="text-xs text-brand-400 truncate max-w-[150px]">{getHostname(biz.website)}</span>
                      </div>
                      <a
                        href={biz.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-white flex items-center gap-1 transition-colors"
                      >
                        Acessar <ExternalLink size={10} />
                      </a>
                    </div>
                  ) : (
                    <div className="bg-slate-900/30 p-2 rounded border border-slate-800 border-dashed text-center text-xs text-slate-600">
                      Website não identificado
                    </div>
                  )}

                  {biz.socialLinks.length > 0 ? (
                    <div className="grid grid-cols-1 gap-2">
                      {biz.socialLinks.map((link, idx) => (
                        <a
                          key={idx}
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 p-2 rounded transition-colors border border-slate-700"
                        >
                          {getSocialIcon(link)}
                          <span className="truncate flex-1">{getHostname(link)}</span>
                          <ExternalLink size={12} className="opacity-50" />
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 italic">Nenhuma rede social identificada.</p>
                  )}
                </div>
              </div>

              {/* Col 3: AI Email Generator */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-brand-400 uppercase tracking-wide flex items-center gap-2">
                    <Sparkles size={14} /> Cold Email (IA)
                  </h4>
                  {!generatedEmail && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onGenerateEmail(biz); }}
                      disabled={loadingEmail}
                      className="text-[10px] bg-brand-600 hover:bg-brand-500 text-white px-2 py-1 rounded flex items-center gap-1 transition-colors disabled:opacity-50"
                    >
                      {loadingEmail ? <Loader2 className="animate-spin" size={10} /> : <Mail size={10} />}
                      Gerar
                    </button>
                  )}
                </div>

                <div className="bg-slate-900 rounded border border-slate-700 flex flex-col h-full min-h-[150px]">
                  {generatedEmail ? (
                    <div className="flex flex-col h-full">
                      <div className="flex-1 p-3 text-xs text-slate-300 font-mono whitespace-pre-wrap overflow-y-auto custom-scrollbar max-h-[180px]">
                        {generatedEmail}
                      </div>
                      <div className="border-t border-slate-800 p-2 flex justify-end bg-slate-900/50">
                        <button
                          onClick={(e) => { e.stopPropagation(); onCopyEmail(generatedEmail, biz.id); }}
                          className="flex items-center gap-1.5 text-[10px] text-slate-400 hover:text-white transition-colors uppercase font-bold tracking-wider"
                        >
                          {copiedEmailId === biz.id ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                          {copiedEmailId === biz.id ? 'Copiado!' : 'Copiar'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-600 p-4 text-center">
                      {loadingEmail ? (
                        <div className="flex flex-col items-center gap-2 animate-pulse">
                          <Sparkles size={20} />
                          <span className="text-xs">Criando abordagem...</span>
                        </div>
                      ) : (
                        <>
                          <Mail size={20} className="mb-2 opacity-50" />
                          <span className="text-xs">Gere um e-mail personalizado para prospecção.</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Main Component ---

export const ResultsTable: React.FC<ResultsTableProps> = ({ data }) => {
  const [localData, setLocalData] = useState<BusinessEntity[]>(data);
  const [statusFilter, setStatusFilter] = useState<string>('Todos');
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [customDateStart, setCustomDateStart] = useState<string>('');
  const [customDateEnd, setCustomDateEnd] = useState<string>('');
  const [locationFilter, setLocationFilter] = useState<LocationFilter>('all');

  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [viewLocationBiz, setViewLocationBiz] = useState<BusinessEntity | null>(null);

  // Email States
  const [generatedEmails, setGeneratedEmails] = useState<Record<string, string>>({});
  const [loadingEmailId, setLoadingEmailId] = useState<string | null>(null);
  const [copiedEmailId, setCopiedEmailId] = useState<string | null>(null);

  // Virtualization Refs
  const listRef = useRef<ReactWindow.VariableSizeList>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const containerSize = useContainerSize(containerRef);

  useEffect(() => {
    setLocalData(data);
  }, [data]);

  const filteredData = useMemo(() => {
    return localData.filter(d => {
      if (statusFilter !== 'Todos' && d.status !== statusFilter) return false;
      if (locationFilter === 'exact' && d.matchType === 'NEARBY') return false;

      // Activity Filtering
      if (d.daysSinceLastActivity === -1 && activityFilter !== 'all') return false;

      const days = d.daysSinceLastActivity;
      if (activityFilter === '30days' && days > 30) return false;
      if (activityFilter === '90days' && days > 90) return false;

      if (activityFilter === 'custom') {
        if (!customDateStart && !customDateEnd) return true; // Se não escolheu nada ainda, mostra tudo

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let maxDays = Infinity;
        let minDays = 0;

        if (customDateStart) {
          const startDate = new Date(customDateStart);
          const diffTime = Math.abs(today.getTime() - startDate.getTime());
          maxDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }

        if (customDateEnd) {
          const endDate = new Date(customDateEnd);
          const diffTime = Math.abs(today.getTime() - endDate.getTime());
          minDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }

        const actualMin = Math.min(minDays, maxDays);
        const actualMax = Math.max(minDays, maxDays);

        if (days < actualMin || days > actualMax) return false;
      }

      return true;
    });
  }, [localData, statusFilter, activityFilter, locationFilter, customDateStart, customDateEnd]);

  // Actions
  const toggleRow = useCallback((id: string) => {
    setExpandedRowId(prev => {
      const isClosing = prev === id;
      // Precisamos resetar a altura da linha no react-window
      if (listRef.current) {
        // Encontra o index
        const idx = filteredData.findIndex(d => d.id === id);
        if (idx !== -1) {
          // Reseta layout a partir deste índice
          listRef.current.resetAfterIndex(idx);
          // Se estiver fechando e abrindo outro, também precisamos resetar o anterior
          if (!isClosing && prev) {
            const prevIdx = filteredData.findIndex(d => d.id === prev);
            if (prevIdx !== -1 && prevIdx < idx) listRef.current.resetAfterIndex(prevIdx);
          }
        }
      }
      return isClosing ? null : id;
    });
  }, [filteredData]);

  const handleToggleProspect = useCallback(async (e: React.MouseEvent, business: BusinessEntity) => {
    e.stopPropagation();
    setLocalData(prev => prev.map(b =>
      b.id === business.id ? { ...b, isProspect: !b.isProspect } : b
    ));
    await dbService.toggleProspect(business);
  }, []);

  const handleGenerateEmail = useCallback(async (biz: BusinessEntity) => {
    setLoadingEmailId(biz.id);
    try {
      const email = await generateOutreachEmail(biz);
      setGeneratedEmails(prev => ({ ...prev, [biz.id]: email }));
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingEmailId(null);
    }
  }, []);

  const copyToClipboard = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedEmailId(id);
    setTimeout(() => setCopiedEmailId(null), 2000);
  }, []);

  const handleViewMap = useCallback((biz: BusinessEntity) => {
    setViewLocationBiz(biz);
  }, []);

  const handleExportCSV = useCallback(() => {
    const headers = ["Nome", "Prospect", "Status", "Score", "Categoria", "Telefone", "Site", "Última Ativ.", "Dias", "Endereço", "Match"];
    const rows = filteredData.map(b => [
      `"${b.name}"`, b.isProspect ? "Sim" : "Não", b.status, b.trustScore, `"${b.category}"`,
      `"${b.phone || ''}"`, `"${b.website || ''}"`, `"${b.lastActivityEvidence || ''}"`,
      b.daysSinceLastActivity, `"${b.address}"`, b.matchType === 'NEARBY' ? "Proximidade" : "Exato"
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `vericorp_export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [filteredData]);

  const handleExportWebhook = useCallback(async () => {
    const url = localStorage.getItem('vericorp_webhook_url');
    if (!url) {
      alert("Por favor, configure a URL do Webhook nas configurações (ícone de engrenagem) antes de exportar.");
      return;
    }

    const confirmSend = window.confirm(`Deseja enviar ${filteredData.length} registros para o Webhook configurado?`);
    if (!confirmSend) return;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exportedAt: new Date().toISOString(),
          count: filteredData.length,
          data: filteredData
        })
      });

      if (response.ok) {
        alert("Dados enviados para o Webhook com sucesso!");
      } else {
        alert(`Erro ao enviar: ${response.statusText}`);
      }
    } catch (error) {
      console.error("Webhook Export Error:", error);
      alert("Falha na conexão com o Webhook.");
    }
  }, [filteredData]);

  // Função para calcular altura da linha dinamicamente
  const getItemSize = (index: number) => {
    const item = filteredData[index];
    return expandedRowId === item.id ? (ROW_HEIGHT + EXPANDED_CONTENT_HEIGHT) : ROW_HEIGHT;
  };

  // OTIMIZAÇÃO: Memoizar o objeto itemData passado para a lista
  const itemData = useMemo(() => ({
    items: filteredData,
    expandedRowId,
    toggleRow,
    onToggleProspect: handleToggleProspect,
    onGenerateEmail: handleGenerateEmail,
    generatedEmails,
    loadingEmailId,
    onCopyEmail: copyToClipboard,
    copiedEmailId,
    onViewMap: handleViewMap
  }), [
    filteredData, expandedRowId, toggleRow, handleToggleProspect,
    handleGenerateEmail, generatedEmails, loadingEmailId,
    copyToClipboard, copiedEmailId, handleViewMap
  ]);

  if (!List) {
    return <div className="text-red-500 p-4">Erro ao carregar componente de lista virtual.</div>;
  }

  return (
    <div className="w-full h-full flex flex-col animate-fadeIn">
      {viewLocationBiz && (
        <LocationModal biz={viewLocationBiz} onClose={() => setViewLocationBiz(null)} />
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-4 mb-4">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div className="flex gap-2 overflow-x-auto w-full lg:w-auto pb-2 lg:pb-0 custom-scrollbar items-center">
            {['Todos', ...Object.values(BusinessStatus)].map(status => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${statusFilter === status
                  ? 'bg-brand-600 text-white shadow-lg shadow-brand-500/20'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
              >
                {status}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setLocationFilter(prev => prev === 'all' ? 'exact' : 'all')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors border ${locationFilter === 'exact'
                ? 'bg-brand-900/40 text-brand-300 border-brand-500/50'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                }`}
            >
              <Target size={16} />
              <span>{locationFilter === 'exact' ? 'Local Exato' : 'Toda Região'}</span>
            </button>

            <div className="flex items-center gap-2 text-sm text-slate-400 bg-slate-900/50 p-2 rounded-lg border border-slate-800 transition-all hover:border-slate-600">
              <Calendar size={16} className={activityFilter === 'custom' ? 'text-brand-400' : ''} />
              <select
                value={activityFilter}
                onChange={(e) => setActivityFilter(e.target.value as ActivityFilter)}
                className="bg-transparent border-none text-slate-200 text-sm rounded focus:ring-0 py-0.5 px-2 cursor-pointer"
              >
                <option value="all" className="bg-slate-800">Qualquer data</option>
                <option value="30days" className="bg-slate-800">Últimos 30 dias</option>
                <option value="90days" className="bg-slate-800">Últimos 90 dias</option>
                <option value="custom" className="bg-slate-800">Personalizado...</option>
              </select>

              {/* Inputs de Data Personalizados (aparecem apenas se 'custom' for selecionado) */}
              {activityFilter === 'custom' && (
                <div className="flex items-center gap-2 ml-2 pl-2 border-l border-slate-700 animate-fadeIn">
                  <input
                    type="date"
                    value={customDateStart}
                    onChange={(e) => setCustomDateStart(e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded text-xs text-white px-2 py-1 focus:ring-1 focus:ring-brand-500 outline-none"
                    title="Data Inicial (Mais antiga)"
                  />
                  <span className="text-slate-500">-</span>
                  <input
                    type="date"
                    value={customDateEnd}
                    onChange={(e) => setCustomDateEnd(e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded text-xs text-white px-2 py-1 focus:ring-1 focus:ring-brand-500 outline-none"
                    title="Data Final (Mais recente)"
                  />
                </div>
              )}
            </div>

            {/* Badge Visual de Intervalo Ativo */}
            {activityFilter === 'custom' && customDateStart && customDateEnd && (
              <div className="hidden xl:flex items-center gap-1 bg-brand-500/10 text-brand-400 border border-brand-500/20 px-2 py-1 rounded text-xs">
                <Filter size={10} />
                <span>{new Date(customDateStart).toLocaleDateString('pt-BR')} - {new Date(customDateEnd).toLocaleDateString('pt-BR')}</span>
              </div>
            )}

            <button
              onClick={handleExportCSV}
              disabled={filteredData.length === 0}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition-colors"
              title="Exportar CSV"
            >
              <Download size={20} />
            </button>

            <button
              onClick={handleExportWebhook}
              disabled={filteredData.length === 0}
              className="p-2 bg-brand-600 hover:bg-brand-500 text-white rounded-lg border border-brand-500 transition-colors shadow-lg shadow-brand-500/20"
              title="Enviar para Webhook"
            >
              <Share2 size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* Grid Header (Fixed) */}
      <div className="bg-slate-800 rounded-t-xl border border-slate-700 border-b-0">
        <div className="grid gap-4 py-3 px-2 text-slate-400 text-xs font-bold uppercase tracking-wider" style={{ gridTemplateColumns: GRID_TEMPLATE }}>
          <div className="text-center">#</div>
          <div className="text-center"><Star size={14} className="mx-auto" /></div>
          <div>Empresa</div>
          <div>Status</div>
          <div>Contato</div>
          <div>Atividade</div>
          <div className="text-right pr-4">Score</div>
        </div>
      </div>

      {/* Virtualized List Container */}
      <div className="flex-1 bg-slate-800 rounded-b-xl border border-slate-700 overflow-hidden relative min-h-[500px]" ref={containerRef}>
        {filteredData.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500">
            <p>Nenhum resultado encontrado.</p>
          </div>
        ) : (
          <List
            ref={listRef}
            height={Math.max(500, containerSize.height)} // Garante altura mínima
            width={containerSize.width}
            itemCount={filteredData.length}
            itemSize={getItemSize}
            itemData={itemData}
            className="custom-scrollbar"
            overscanCount={5} // Renderiza 5 itens extras acima/abaixo para scroll suave
          >
            {VirtualRow}
          </List>
        )}
      </div>

      <div className="mt-2 text-xs text-slate-500 text-right">
        Exibindo {filteredData.length} de {data.length} registros
      </div>
    </div>
  );
};