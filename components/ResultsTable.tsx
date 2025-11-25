import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { BusinessEntity, BusinessStatus } from '../types';
import { generateOutreachEmail } from '../services/geminiService';
import { dbService } from '../services/dbService';
import { 
  ExternalLink, Phone, Globe, AlertTriangle, CheckCircle, Download, 
  Activity, ChevronDown, ChevronUp, Calendar, Instagram, Facebook, Linkedin,
  ChevronLeft, ChevronRight, Mail, Sparkles, Copy, Loader2, Check, Star, MessageCircle, MapPin, Target
} from 'lucide-react';

interface ResultsTableProps {
  data: BusinessEntity[];
}

type ActivityFilter = 'all' | '30days' | '90days';
type LocationFilter = 'all' | 'exact';

// --- Sub-components & Helpers ---

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
  if (url.includes('instagram')) return <Instagram size={16} />;
  if (url.includes('facebook')) return <Facebook size={16} />;
  if (url.includes('linkedin')) return <Linkedin size={16} />;
  if (url.includes('wa.me') || url.includes('whatsapp')) return <MessageCircle size={16} />;
  return <ExternalLink size={16} />;
};

// --- Memoized Row Component ---
// Critical for performance when list grows during streaming
interface BusinessRowProps {
  biz: BusinessEntity;
  isExpanded: boolean;
  toggleRow: (id: string) => void;
  onToggleProspect: (e: React.MouseEvent, biz: BusinessEntity) => void;
  onGenerateEmail: (biz: BusinessEntity) => void;
  generatedEmail?: string;
  loadingEmail: boolean;
  onCopyEmail: (text: string, id: string) => void;
  copiedEmailId: string | null;
}

const BusinessRow = React.memo(({ 
  biz, isExpanded, toggleRow, onToggleProspect, 
  onGenerateEmail, generatedEmail, loadingEmail, onCopyEmail, copiedEmailId 
}: BusinessRowProps) => {
  return (
    <React.Fragment>
      <tr 
        onClick={() => toggleRow(biz.id)}
        className={`cursor-pointer transition-colors group ${isExpanded ? 'bg-slate-700/40' : 'hover:bg-slate-700/30'}`}
      >
        <td className="p-4 text-slate-500 w-10">
          {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </td>
        <td className="p-4 text-center w-12">
          <button 
            onClick={(e) => onToggleProspect(e, biz)}
            className="hover:scale-110 transition-transform p-1 rounded-full hover:bg-slate-600 focus:outline-none"
            title={biz.isProspect ? "Remover dos favoritos" : "Marcar como prospect"}
          >
            <Star 
              size={18} 
              className={biz.isProspect ? "fill-amber-400 text-amber-400" : "text-slate-600 group-hover:text-slate-500"} 
            />
          </button>
        </td>
        <td className="p-4">
          <div className="flex items-center gap-2">
             <div className="font-bold text-slate-200 group-hover:text-brand-400 transition-colors">{biz.name}</div>
             {biz.matchType === 'NEARBY' && (
                <span className="text-[10px] uppercase font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 whitespace-nowrap flex items-center gap-1" title="Este resultado foi encontrado numa região próxima à solicitada">
                  <AlertTriangle size={8} /> Região Próxima
                </span>
             )}
          </div>
          <div className="text-xs text-slate-500 mt-1">{biz.category}</div>
        </td>
        <td className="p-4">
          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(biz.status)}`}>
            {biz.status === BusinessStatus.VERIFIED && <CheckCircle size={10} />}
            {biz.status === BusinessStatus.SUSPICIOUS && <AlertTriangle size={10} />}
            {biz.status}
          </span>
        </td>
        <td className="p-4">
          <div className="flex flex-col gap-1 text-xs text-slate-300">
            {biz.phone ? (
              <div className="flex items-center gap-2 group/phone">
                <Phone size={12} className="text-slate-500" />
                <span>{biz.phone}</span>
                <a 
                  href={`https://wa.me/${biz.phone.replace(/\D/g,'')}?text=Olá, encontrei a ${encodeURIComponent(biz.name)} e gostaria de mais informações.`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="opacity-0 group-hover/phone:opacity-100 transition-opacity ml-2 text-emerald-400 hover:text-emerald-300 bg-emerald-900/30 p-1 rounded-full"
                  title="Abrir WhatsApp"
                >
                  <MessageCircle size={12} />
                </a>
              </div>
            ) : <span className="text-slate-600">Sem telefone</span>}
          </div>
        </td>
        <td className="p-4">
            <div className="flex items-center gap-2">
              <Activity size={14} className={biz.daysSinceLastActivity <= 30 && biz.daysSinceLastActivity !== -1 ? "text-emerald-400" : "text-slate-500"} />
              <span className="text-xs text-slate-300">
                {biz.daysSinceLastActivity === 0 
                  ? 'Hoje' 
                  : biz.daysSinceLastActivity > 0 
                    ? `${biz.daysSinceLastActivity} dias atrás`
                    : 'Desconhecido'}
              </span>
            </div>
        </td>
        <td className="p-4 text-right">
          <div className="inline-flex items-center gap-2 bg-slate-900/50 px-2 py-1 rounded">
            <div className={`w-2 h-2 rounded-full ${biz.trustScore > 75 ? 'bg-emerald-500' : biz.trustScore > 40 ? 'bg-amber-500' : 'bg-red-500'}`} />
            <span className="text-xs font-mono font-bold text-slate-300">{biz.trustScore}</span>
          </div>
        </td>
      </tr>
      
      {/* Expanded Detail Row */}
      {isExpanded && (
        <tr className="bg-slate-700/20 animate-fadeIn cursor-default">
          <td colSpan={7} className="p-0">
            <div className="p-6 border-l-2 border-brand-500 ml-4 md:ml-0">
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-brand-400 uppercase tracking-wide flex items-center gap-2">
                    <Activity size={16} /> Detalhes de Atividade
                  </h4>
                  <p className="text-sm text-slate-300 bg-slate-800 p-3 rounded border border-slate-700">
                    "{biz.lastActivityEvidence || "Nenhuma evidência textual encontrada."}"
                  </p>
                  <div className="text-xs text-slate-500">
                    <p className="flex items-center gap-1 mb-1"><MapPin size={10} /> Endereço:</p>
                    <p className="text-slate-300">{biz.address}</p>
                    {biz.matchType === 'NEARBY' && (
                        <p className="text-amber-500 mt-1 italic flex items-center gap-1 bg-amber-500/10 p-1 rounded border border-amber-500/20">
                           <AlertTriangle size={10} /> 
                           Localizado em região próxima (Fora do alvo exato)
                        </p>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-brand-400 uppercase tracking-wide flex items-center gap-2">
                    <Globe size={16} /> Presença Digital
                  </h4>
                  {biz.socialLinks.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {biz.socialLinks.map((link, idx) => (
                        <a 
                          key={idx} 
                          href={link} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 p-2 rounded transition-colors border border-slate-700"
                        >
                          {getSocialIcon(link)}
                          <span className="truncate flex-1">{new URL(link).hostname}</span>
                          <ExternalLink size={12} className="opacity-50" />
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 italic">Nenhuma rede social identificada.</p>
                  )}
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-brand-400 uppercase tracking-wide">Website</h4>
                  {biz.website ? (
                    <div className="bg-slate-900 rounded-lg overflow-hidden border border-slate-700 h-full flex flex-col">
                      <div className="h-24 bg-slate-800 flex items-center justify-center relative overflow-hidden group">
                          <div className="absolute inset-0 opacity-10 bg-[url('https://images.unsplash.com/photo-1460925895917-afdab827c52f?q=80&w=2015&auto=format&fit=crop')] bg-cover bg-center"></div>
                          <Globe size={32} className="text-slate-600 relative z-10" />
                      </div>
                      <div className="p-3 flex-1 flex flex-col justify-between">
                          <div className="text-xs text-slate-400 truncate mb-2">{biz.website}</div>
                          <a 
                            href={biz.website} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="w-full mt-auto bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold py-2 px-4 rounded text-center transition-colors flex items-center justify-center gap-2"
                          >
                            Visitar Site <ExternalLink size={12} />
                          </a>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full bg-slate-800/50 rounded-lg border border-slate-700 border-dashed flex flex-col items-center justify-center text-slate-600 p-4">
                      <Globe size={24} className="mb-2 opacity-50" />
                      <span className="text-xs">Website não disponível</span>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="bg-slate-800 rounded border border-slate-700 p-4">
                  <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                    <h4 className="text-sm font-semibold text-brand-400 uppercase tracking-wide flex items-center gap-2">
                      <Sparkles size={16} /> Gerador de Abordagem Comercial (IA)
                    </h4>
                    {!generatedEmail && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); onGenerateEmail(biz); }}
                        disabled={loadingEmail}
                        className="text-xs bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded flex items-center gap-2 transition-colors disabled:opacity-50 shadow-sm"
                      >
                        {loadingEmail ? <Loader2 className="animate-spin" size={12}/> : <Mail size={12} />}
                        Gerar Rascunho
                      </button>
                    )}
                  </div>
                  
                  {generatedEmail ? (
                    <div className="animate-fadeIn">
                      <div className="bg-slate-900/50 p-4 rounded text-sm text-slate-300 font-mono whitespace-pre-wrap border border-slate-700/50 max-h-60 overflow-y-auto custom-scrollbar">
                        {generatedEmail}
                      </div>
                      <div className="mt-2 flex justify-end">
                        <button
                          onClick={(e) => { e.stopPropagation(); onCopyEmail(generatedEmail, biz.id); }}
                          className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors"
                        >
                          {copiedEmailId === biz.id ? <Check size={14} className="text-emerald-500"/> : <Copy size={14} />}
                          {copiedEmailId === biz.id ? 'Copiado!' : 'Copiar texto'}
                        </button>
                      </div>
                    </div>
                  ) : !loadingEmail && (
                    <p className="text-xs text-slate-500 italic">
                      Clique em "Gerar Rascunho" para que a IA crie uma mensagem personalizada.
                    </p>
                  )}
                  {loadingEmail && (
                      <div className="py-4 text-center text-xs text-slate-400 animate-pulse">
                        Analisando perfil...
                      </div>
                  )}
              </div>

            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}, (prev, next) => {
  return (
    prev.biz === next.biz && 
    prev.isExpanded === next.isExpanded &&
    prev.generatedEmail === next.generatedEmail &&
    prev.loadingEmail === next.loadingEmail &&
    prev.copiedEmailId === next.copiedEmailId
  );
});

// --- Main Component ---

export const ResultsTable: React.FC<ResultsTableProps> = ({ data }) => {
  const [localData, setLocalData] = useState<BusinessEntity[]>(data);
  const [statusFilter, setStatusFilter] = useState<string>('Todos');
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [locationFilter, setLocationFilter] = useState<LocationFilter>('all'); // Novo estado
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  
  // Email Generator State
  const [generatedEmails, setGeneratedEmails] = useState<Record<string, string>>({});
  const [loadingEmailId, setLoadingEmailId] = useState<string | null>(null);
  const [copiedEmailId, setCopiedEmailId] = useState<string | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    setLocalData(data);
  }, [data]);

  // Performance Optimization: 
  // Otimização crucial: O useMemo deve depender apenas dos filtros e dos dados.
  // Isso evita recálculos se outros estados não relacionados mudarem.
  const filteredData = useMemo(() => {
    return localData.filter(d => {
      // Status Filter
      if (statusFilter !== 'Todos' && d.status !== statusFilter) return false;
      
      // Activity Filter
      if (activityFilter === '30days') {
        return d.daysSinceLastActivity !== -1 && d.daysSinceLastActivity <= 30;
      }
      if (activityFilter === '90days') {
        return d.daysSinceLastActivity !== -1 && d.daysSinceLastActivity <= 90;
      }

      // Location Filter (Exact Match)
      if (locationFilter === 'exact' && d.matchType === 'NEARBY') {
        return false;
      }
      
      return true;
    });
  }, [localData, statusFilter, activityFilter, locationFilter]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  
  // Reset de página inteligente: Só reseta se a página atual não existir mais.
  // Isso permite que o usuário navegue enquanto os dados estão chegando (streaming).
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [totalPages, currentPage]);

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredData.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredData, currentPage, itemsPerPage]);

  const toggleRow = useCallback((id: string) => {
    setExpandedRowId(prev => prev === id ? null : id);
  }, []);

  const handleToggleProspect = useCallback(async (e: React.MouseEvent, business: BusinessEntity) => {
    e.stopPropagation();
    setLocalData(prev => prev.map(b => 
      b.id === business.id ? { ...b, isProspect: !b.isProspect } : b
    ));
    await dbService.toggleProspect(business);
  }, []);

  const handleExportCSV = useCallback(() => {
    const headers = ["Nome", "Prospect", "Status", "Nota Confiabilidade", "Categoria", "Telefone", "Site", "Última Atividade (Evidência)", "Dias s/ Ativ.", "Endereço", "Match"];
    const rows = filteredData.map(b => [
      `"${b.name}"`,
      b.isProspect ? "Sim" : "Não",
      b.status,
      b.trustScore,
      `"${b.category}"`,
      `"${b.phone || ''}"`,
      `"${b.website || ''}"`,
      `"${b.lastActivityEvidence || ''}"`,
      b.daysSinceLastActivity,
      `"${b.address}"`,
      b.matchType === 'NEARBY' ? "Proximidade" : "Exato"
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `vericorp_exportacao_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [filteredData]);

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

  return (
    <div className="w-full animate-fadeIn">
      {/* Controles */}
      <div className="flex flex-col gap-4 mb-4">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 flex-wrap">
          <div className="flex gap-2 overflow-x-auto w-full md:w-auto pb-2 md:pb-0 custom-scrollbar items-center">
            {['Todos', ...Object.values(BusinessStatus)].map(status => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                  statusFilter === status 
                    ? 'bg-brand-600 text-white shadow-lg shadow-brand-500/20' 
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {status}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
             {/* Filtro de Localização */}
             <button
               onClick={() => setLocationFilter(prev => prev === 'all' ? 'exact' : 'all')}
               className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors border ${
                 locationFilter === 'exact' 
                   ? 'bg-brand-900/40 text-brand-300 border-brand-500/50' 
                   : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
               }`}
               title="Exibe apenas resultados no endereço/bairro exato, removendo expansão de raio"
             >
               <Target size={16} className={locationFilter === 'exact' ? "text-brand-400" : ""} />
               <span>{locationFilter === 'exact' ? 'Apenas Local Exato' : 'Toda a Região'}</span>
             </button>

             <button
              onClick={handleExportCSV}
              disabled={filteredData.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-lg border border-slate-700 transition-colors shrink-0"
            >
              <Download size={16} />
              <span className="hidden sm:inline">Exportar CSV</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-slate-400 bg-slate-900/50 p-2 rounded-lg border border-slate-800 w-fit">
          <Calendar size={16} />
          <span className="mr-2">Atividade Recente:</span>
          <select 
            value={activityFilter}
            onChange={(e) => setActivityFilter(e.target.value as ActivityFilter)}
            className="bg-slate-800 border-none text-slate-200 text-sm rounded focus:ring-1 focus:ring-brand-500 py-1 px-3"
          >
            <option value="all">Qualquer data</option>
            <option value="30days">Últimos 30 dias</option>
            <option value="90days">Últimos 90 dias</option>
          </select>
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-xl flex flex-col min-h-[500px]">
        <div className="overflow-x-auto custom-scrollbar flex-1">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900/50 text-slate-400 text-sm uppercase tracking-wider sticky top-0 z-10">
                <th className="p-4 w-10"></th>
                <th className="p-4 w-10 text-center"><Star size={16} /></th>
                <th className="p-4 font-semibold">Empresa</th>
                <th className="p-4 font-semibold">Status</th>
                <th className="p-4 font-semibold">Contato</th>
                <th className="p-4 font-semibold">Atividade</th>
                <th className="p-4 font-semibold text-right">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    Nenhum resultado encontrado com estes filtros.
                  </td>
                </tr>
              ) : (
                paginatedData.map((biz) => (
                  <BusinessRow 
                    key={biz.id}
                    biz={biz}
                    isExpanded={expandedRowId === biz.id}
                    toggleRow={toggleRow}
                    onToggleProspect={handleToggleProspect}
                    onGenerateEmail={handleGenerateEmail}
                    generatedEmail={generatedEmails[biz.id]}
                    loadingEmail={loadingEmailId === biz.id}
                    onCopyEmail={copyToClipboard}
                    copiedEmailId={copiedEmailId}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        {filteredData.length > 0 && (
          <div className="border-t border-slate-700 bg-slate-900/30 p-4 flex items-center justify-between">
            <div className="text-sm text-slate-500">
              Exibindo <span className="text-slate-300 font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> até <span className="text-slate-300 font-medium">{Math.min(currentPage * itemsPerPage, filteredData.length)}</span> de <span className="text-slate-300 font-medium">{filteredData.length}</span> resultados
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-2 rounded hover:bg-slate-700 text-slate-400 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronLeft size={20} />
              </button>
              
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pNum = i + 1;
                  if (totalPages > 5) {
                     if (currentPage <= 3) pNum = i + 1;
                     else if (currentPage >= totalPages - 2) pNum = totalPages - 4 + i;
                     else pNum = currentPage - 2 + i;
                  }
                  
                  return (
                    <button
                      key={pNum}
                      onClick={() => setCurrentPage(pNum)}
                      className={`w-8 h-8 rounded text-sm font-medium ${
                        currentPage === pNum 
                          ? 'bg-brand-600 text-white' 
                          : 'text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      {pNum}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-2 rounded hover:bg-slate-700 text-slate-400 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};