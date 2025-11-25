import React, { useState, useCallback, useEffect } from 'react';
import { fetchAndAnalyzeBusinesses } from './services/geminiService';
import { BusinessEntity } from './types';
import { ResultsTable } from './components/ResultsTable';
import { ResultsMap } from './components/ResultsMap';
import { Search, MapPin, Database, Radar, Loader2, Key, ListFilter, Globe2 } from 'lucide-react';

const STORAGE_KEYS = {
  SEGMENT: 'vericorp_last_segment',
  REGION: 'vericorp_last_region',
  MAX_RESULTS: 'vericorp_last_max_results'
};

const App: React.FC = () => {
  // Inicializa estados buscando do localStorage se existir
  const [segment, setSegment] = useState(() => localStorage.getItem(STORAGE_KEYS.SEGMENT) || '');
  const [region, setRegion] = useState(() => localStorage.getItem(STORAGE_KEYS.REGION) || '');
  const [maxResults, setMaxResults] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.MAX_RESULTS);
    return saved ? Number(saved) : 20;
  });

  const [isLoading, setIsLoading] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [results, setResults] = useState<BusinessEntity[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const hasKey = !!process.env.API_KEY;
  
  // Modo Varredura ativa se não houver segmento digitado
  const isSweepMode = segment.trim() === '';

  const handleSearch = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!region) return;

    // Persistir parâmetros atuais no localStorage
    localStorage.setItem(STORAGE_KEYS.SEGMENT, segment);
    localStorage.setItem(STORAGE_KEYS.REGION, region);
    localStorage.setItem(STORAGE_KEYS.MAX_RESULTS,String(maxResults));

    if (!hasKey) {
        try {
            if (window.aistudio && window.aistudio.openSelectKey) {
                await window.aistudio.openSelectKey();
            }
        } catch (err) {
            setError("Sistema de Chave API indisponível. Verifique se o ambiente está configurado.");
        }
    }

    setIsLoading(true);
    setError(null);
    setResults([]);
    setProgressMsg(isSweepMode 
      ? "Iniciando varredura geográfica de múltiplos setores..." 
      : "Inicializando protocolo de busca segmentada...");

    try {
      const searchSegment = isSweepMode ? "Varredura Geral (Multisetorial)" : segment;
      const data = await fetchAndAnalyzeBusinesses(searchSegment, region, maxResults, (msg) => setProgressMsg(msg));
      setResults(data);
    } catch (err: any) {
      setError(err.message || "Ocorreu um erro inesperado.");
    } finally {
      setIsLoading(false);
      setProgressMsg('');
    }
  }, [segment, region, maxResults, hasKey, isSweepMode]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-brand-500/30">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 text-brand-500">
            <Radar size={28} />
            <h1 className="text-xl font-bold tracking-tight text-white">VeriCorp <span className="text-slate-500 font-normal">| AI Scout</span></h1>
          </div>
          <div className="text-xs text-slate-500 hidden md:block">
            Powered by Google Gemini 2.5 Flash
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        
        {/* Intro / Search Section */}
        <section className="max-w-4xl mx-auto mb-12 text-center">
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">
            Inteligência Comercial Automatizada
          </h2>
          <p className="text-slate-400 mb-8 text-lg">
            Encontre, verifique e filtre leads de negócios usando verificação em tempo real e análise de NLP.
          </p>

          {!hasKey && (
             <div className="mb-6 p-4 bg-amber-900/20 border border-amber-500/50 text-amber-200 rounded-lg text-sm flex items-center justify-center gap-2">
                 <Key size={16} />
                 <span>Chave API necessária. Configure seu ambiente ou use o seletor de faturamento se disponível.</span>
             </div>
          )}

          <form onSubmit={handleSearch} className="bg-slate-900 p-2 rounded-2xl border border-slate-800 shadow-2xl flex flex-col md:flex-row gap-2 relative">
             <div className="flex-[2] relative group">
                {isSweepMode ? (
                   <Globe2 className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500 animate-pulse" size={20} />
                ) : (
                   <Database className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-brand-500 transition-colors" size={20} />
                )}
                <input
                  type="text"
                  value={segment}
                  onChange={(e) => setSegment(e.target.value)}
                  placeholder="Segmento (Vazio para Varredura Geral)"
                  className="w-full bg-transparent border-none text-white placeholder-slate-500 focus:ring-0 h-12 pl-10 pr-4"
                  disabled={isLoading}
                />
                {isSweepMode && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] uppercase font-bold text-emerald-500 border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 rounded">
                    Modo Varredura
                  </span>
                )}
             </div>
             <div className="w-px bg-slate-800 hidden md:block"></div>
             <div className="flex-[2] relative group">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-brand-500 transition-colors" size={20} />
                <input
                  type="text"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="Região (Bairro, Rua ou Cidade)"
                  className="w-full bg-transparent border-none text-white placeholder-slate-500 focus:ring-0 h-12 pl-10 pr-4"
                  disabled={isLoading}
                />
             </div>
             <div className="w-px bg-slate-800 hidden md:block"></div>
             <div className="relative group md:w-40 bg-slate-800/50 md:bg-transparent rounded-lg md:rounded-none">
                 <ListFilter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
                 <select 
                    value={maxResults}
                    onChange={(e) => setMaxResults(Number(e.target.value))}
                    className="w-full bg-transparent border-none text-white focus:ring-0 h-12 pl-10 pr-2 appearance-none cursor-pointer"
                    disabled={isLoading}
                 >
                    <option value={20} className="bg-slate-900">20 leads</option>
                    <option value={50} className="bg-slate-900">50 leads</option>
                    <option value={80} className="bg-slate-900">80 leads</option>
                    <option value={100} className="bg-slate-900">100 leads</option>
                 </select>
             </div>
             <button
               type="submit"
               disabled={isLoading || !region}
               className={`px-6 py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 min-w-[140px] ${
                 isSweepMode 
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white' 
                  : 'bg-brand-600 hover:bg-brand-500 text-white'
               } disabled:opacity-50 disabled:cursor-not-allowed`}
             >
               {isLoading ? <Loader2 className="animate-spin" size={20} /> : (isSweepMode ? <Globe2 size={20} /> : <Search size={20} />)}
               {isLoading ? 'Buscando...' : (isSweepMode ? 'Escanear' : 'Buscar')}
             </button>
          </form>
          {isSweepMode && (
            <p className="text-xs text-emerald-400/80 mt-2 flex items-center justify-center gap-1">
              <Globe2 size={12}/> O Modo Varredura encontrará empresas de diversos setores na região indicada.
            </p>
          )}
        </section>

        {/* Error Display */}
        {error && (
          <div className="max-w-3xl mx-auto mb-8 p-4 bg-red-900/20 border border-red-500/50 rounded-lg text-red-200 flex items-start gap-3">
             <div className="mt-1"><AlertIcon /></div>
             <div>
               <h3 className="font-bold">A busca falhou</h3>
               <p className="text-sm opacity-90">{error}</p>
             </div>
          </div>
        )}

        {/* Progress Console */}
        {isLoading && (
          <div className="max-w-2xl mx-auto mb-12">
            <div className="bg-slate-900 rounded-lg border border-slate-700 p-6 font-mono text-sm shadow-inner">
               <div className="flex items-center gap-3 text-brand-400 mb-2">
                 <span className="relative flex h-3 w-3">
                   <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75"></span>
                   <span className="relative inline-flex rounded-full h-3 w-3 bg-brand-500"></span>
                 </span>
                 STATUS_AGENTE: ATIVO
               </div>
               <div className="space-y-1 text-slate-400">
                  <p>{`> Modo: ${isSweepMode ? 'Varredura Geográfica (Broad Scan)' : 'Busca Segmentada'}`}</p>
                  <p>{`> Segmento: ${segment || 'MULTIPLE_SECTORS'}`}</p>
                  <p>{`> Região: ${region}`}</p>
                  <p>{`> Meta: ${maxResults} resultados`}</p>
                  <p className="text-slate-200 animate-pulse mt-2">{`> ${progressMsg}`}</p>
               </div>
               {/* Simple visual progress bar simulation */}
               <div className="w-full bg-slate-800 rounded-full h-1.5 mt-4 overflow-hidden">
                 <div className="bg-brand-500 h-1.5 rounded-full animate-progress"></div>
               </div>
            </div>
          </div>
        )}

        {/* Results Section */}
        {results.length > 0 && (
          <div className="animate-slideUp">
             <ResultsMap data={results} />
             <ResultsTable data={results} />
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-900 mt-auto py-8 text-center text-slate-500 text-sm">
        <p>&copy; {new Date().getFullYear()} VeriCorp. Inteligência gerada por IA.</p>
      </footer>
    </div>
  );
};

const AlertIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
);

export default App;