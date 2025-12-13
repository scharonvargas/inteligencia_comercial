import React, { useState, useCallback, useEffect } from 'react';
import { fetchAndAnalyzeBusinesses, clearMemoryCache } from './services/geminiService';
import { BusinessEntity } from './types';
import { ResultsTable } from './components/ResultsTable';
import { ResultsMap } from './components/ResultsMap';
import { KanbanBoard } from './components/KanbanBoard';
import { AddressAutocomplete } from './components/AddressAutocomplete';
import { SettingsModal } from './components/SettingsModal';
import { LoginPage } from './components/LoginPage';
import { useAuth } from './contexts/AuthContext';
import { dbService, rateLimitService, searchHistoryService } from './services/dbService';
import { SearchHistory } from './components/SearchHistory';
import { LeadListsManager } from './components/LeadLists';
import { Dashboard } from './components/Dashboard';
import { MessageTemplates } from './components/MessageTemplates';
import {
  Search, MapPin, Database, Radar, Loader2, Key, ListFilter, Globe2, Lightbulb, Info,
  LayoutList, KanbanSquare, Trash2, Check, Settings, LogOut, BarChart3, Tag, MessageSquare
} from 'lucide-react';

const STORAGE_KEYS = {
  SEGMENT: 'vericorp_last_segment',
  REGION: 'vericorp_last_region',
  MAX_RESULTS: 'vericorp_last_max_results'
};

const App: React.FC = () => {
  const { user, loading: authLoading, signOut } = useAuth();

  // Inicializa estados buscando do localStorage se existir
  const [segment, setSegment] = useState(() => localStorage.getItem(STORAGE_KEYS.SEGMENT) || '');
  const [region, setRegion] = useState(() => localStorage.getItem(STORAGE_KEYS.REGION) || '');
  const [maxResults, setMaxResults] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.MAX_RESULTS);
    return saved ? Number(saved) : 20;
  });

  // Estado para coordenadas geográficas precisas
  const [searchCoords, setSearchCoords] = useState<{ lat: number, lng: number } | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [results, setResults] = useState<BusinessEntity[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Controle de Visualização
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');

  // Status do Banco de Dados
  const [dbStatus, setDbStatus] = useState<'loading' | 'online' | 'offline'>('loading');

  // Estado para feedback de limpeza de cache
  const [cacheCleaned, setCacheCleaned] = useState(false);

  // Ref para controle de cancelamento de busca
  const abortControllerRef = React.useRef<AbortController | null>(null);

  // Estado para Modal de Configurações
  const [showSettings, setShowSettings] = useState(false);

  // Estado para Rate Limiting
  const [searchesRemaining, setSearchesRemaining] = useState<number | null>(null);

  // Estado para Lead Lists Manager
  const [showLeadLists, setShowLeadLists] = useState(false);

  // Estado para Dashboard
  const [showDashboard, setShowDashboard] = useState(false);

  // Estado para Message Templates
  const [showTemplates, setShowTemplates] = useState(false);

  // Estado para prospects
  const [prospects, setProspects] = useState<BusinessEntity[]>([]);

  const handleStopSearch = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
      setProgressMsg("⚠️ Busca interrompida pelo usuário.");
    }
  }, []);

  const hasKey = !!process.env.API_KEY;
  const isSweepMode = segment.trim() === '';

  // Verificar conexão com BD ao iniciar
  useEffect(() => {
    const checkDb = async () => {
      const isConnected = await dbService.testConnection();
      setDbStatus(isConnected ? 'online' : 'offline');
    };
    checkDb();
  }, []);

  // Load initial rate limit count
  useEffect(() => {
    const loadRateLimit = async () => {
      const data = await rateLimitService.getSearchCount();
      setSearchesRemaining(data.remaining);
    };
    loadRateLimit();
  }, []);

  // Load prospects on mount
  useEffect(() => {
    const loadProspects = async () => {
      const allProspects = await dbService.getAllProspects();
      setProspects(allProspects);
    };
    loadProspects();
  }, []);

  const handleSearch = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!region) return;

    // Persistir parâmetros
    localStorage.setItem(STORAGE_KEYS.SEGMENT, segment);
    localStorage.setItem(STORAGE_KEYS.REGION, region);
    localStorage.setItem(STORAGE_KEYS.MAX_RESULTS, String(maxResults));

    if (!hasKey) {
      try {
        if (window.aistudio && window.aistudio.openSelectKey) {
          await window.aistudio.openSelectKey();
        }
      } catch (err) {
        setError("Sistema de Chave API indisponível. Verifique se o ambiente está configurado.");
      }
    }

    // Check rate limit before proceeding
    const rateCheck = await rateLimitService.canSearch();
    setSearchesRemaining(rateCheck.remaining);

    if (!rateCheck.allowed) {
      setError(`Limite diário de ${rateCheck.limit} buscas atingido. Tente novamente amanhã.`);
      return;
    }

    setIsLoading(true);
    setError(null);
    setResults([]); // Limpa resultados anteriores para começar do zero

    // Aborta busca anterior se houver (safety check)
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    // Cria novo controlador
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const regionLower = region.toLowerCase();
    // Regex refinado para detectar nível de logradouro
    const isStreetLevel = /rua|av\.|avenida|travessa|alameda|rodovia|estrada|pr\.|praça|largo/i.test(regionLower);
    const isNeighborhoodLevel = /bairro|jardim|centro|vila|parque/i.test(regionLower);

    let initMsg = "";
    if (isSweepMode) {
      if (searchCoords && isStreetLevel) {
        // Prioridade máxima: Coordenada + Contexto de Rua
        initMsg = `Varredura de Precisão: Mapeando estabelecimentos na via exata (GPS: ${searchCoords.lat.toFixed(4)}, ${searchCoords.lng.toFixed(4)})...`;
      } else if (searchCoords) {
        initMsg = `Analisando raio de alta precisão GPS (${searchCoords.lat.toFixed(4)}, ${searchCoords.lng.toFixed(4)})...`;
      } else if (isStreetLevel) {
        initMsg = "Iniciando varredura de alta precisão na via especificada...";
      } else if (isNeighborhoodLevel) {
        initMsg = "Mapeando ecossistema comercial do bairro...";
      } else {
        initMsg = "Iniciando varredura geográfica ampla...";
      }
    } else {
      initMsg = `Inicializando busca segmentada por "${segment}"...`;
    }
    setProgressMsg(initMsg);

    try {
      const searchSegment = isSweepMode ? "Varredura Geral (Multisetorial)" : segment;

      // STREAMING: Passamos um callback extra para receber lotes de dados
      await fetchAndAnalyzeBusinesses(
        searchSegment,
        region,
        maxResults,
        (msg) => setProgressMsg(msg),
        (newBatch) => {
          // Callback executado a cada lote encontrado
          setResults(prev => [...prev, ...newBatch]);
        },
        searchCoords, // Passamos as coordenadas opcionais
        controller.signal // Passamos o sinal de aborto
      );

      // Nota: fetchAndAnalyzeBusinesses retorna o array completo no final, 
      // mas já fomos atualizando o estado via callback, então não precisamos setar de novo aqui
      // a menos que queiramos garantir sincronia total.

      // Increment rate limit counter after successful search
      await rateLimitService.incrementSearchCount();
      const updatedLimit = await rateLimitService.getSearchCount();
      setSearchesRemaining(updatedLimit.remaining);

      // Save to search history
      await searchHistoryService.saveSearch(segment, region, results.length);
    } catch (err: any) {
      setError(err.message || "Ocorreu um erro inesperado.");
    } finally {
      setIsLoading(false);
      setProgressMsg('');
    }
  }, [segment, region, maxResults, hasKey, isSweepMode, searchCoords]);

  // Handler para atualizar o estágio no Kanban (e refletir na lista principal)
  const handlePipelineChange = useCallback(async (businessId: string, newStage: string) => {
    // 1. Atualiza UI localmente
    setResults(prev => prev.map(b =>
      b.id === businessId ? { ...b, pipelineStage: newStage } : b
    ));

    // 2. Persiste no BD
    await dbService.updatePipelineStage(businessId, newStage);
  }, []);

  // Handler para quando o autocomplete seleciona um local
  const handleLocationSelect = useCallback((lat: number, lng: number) => {
    setSearchCoords({ lat, lng });
  }, []);

  // Se o usuário digitar manualmente, limpamos as coordenadas para evitar conflito
  const handleRegionChange = useCallback((val: string) => {
    setRegion(val);
    // Só limpa coordenadas se o texto mudar drasticamente (opcional, aqui limpamos por segurança)
    // setSearchCoords(null); 
  }, []);

  // Handler para limpar cache
  const handleClearCache = useCallback(() => {
    clearMemoryCache();
    setCacheCleaned(true);
    setTimeout(() => setCacheCleaned(false), 2000);
  }, []);

  // Show loading state while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="animate-spin text-brand-500" size={48} />
      </div>
    );
  }

  // Show login page if not authenticated
  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-brand-500/30 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 text-brand-500">
            <Radar size={28} />
            <h1 className="text-xl font-bold tracking-tight text-white">VeriCorp <span className="text-slate-500 font-normal">| AI Scout</span></h1>
          </div>
          <div className="flex items-center gap-4">
            {/* View Toggle */}
            {results.length > 0 && (
              <div className="bg-slate-800 p-1 rounded-lg flex border border-slate-700">
                <button
                  onClick={() => setViewMode('table')}
                  className={`p-1.5 rounded transition-colors ${viewMode === 'table' ? 'bg-slate-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                  title="Visualização em Lista"
                >
                  <LayoutList size={18} />
                </button>
                <button
                  onClick={() => setViewMode('kanban')}
                  className={`p-1.5 rounded transition-colors ${viewMode === 'kanban' ? 'bg-slate-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                  title="Visualização Kanban"
                >
                  <KanbanSquare size={18} />
                </button>
              </div>
            )}
            <div className="text-xs text-slate-500 hidden md:flex items-center gap-2">
              <span>Gemini 2.5 Flash</span>
              {searchesRemaining !== null && (
                <span className={`px-2 py-0.5 rounded-full ${searchesRemaining > 10 ? 'bg-emerald-500/20 text-emerald-400' : searchesRemaining > 0 ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400'}`}>
                  {searchesRemaining} buscas restantes
                </span>
              )}
            </div>
            <button
              onClick={() => setShowDashboard(true)}
              className="text-slate-400 hover:text-white transition-colors p-2 hover:bg-slate-800 rounded-lg"
              title="Dashboard"
            >
              <BarChart3 size={20} />
            </button>
            <button
              onClick={() => setShowTemplates(true)}
              className="text-slate-400 hover:text-white transition-colors p-2 hover:bg-slate-800 rounded-lg"
              title="Templates de Mensagem"
            >
              <MessageSquare size={20} />
            </button>
            <button
              onClick={() => setShowLeadLists(true)}
              className="text-slate-400 hover:text-white transition-colors p-2 hover:bg-slate-800 rounded-lg"
              title="Gerenciar Listas"
            >
              <Tag size={20} />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="text-slate-400 hover:text-white transition-colors p-2 hover:bg-slate-800 rounded-lg"
              title="Configurações"
            >
              <Settings size={20} />
            </button>
            <button
              onClick={signOut}
              className="text-slate-400 hover:text-red-400 transition-colors p-2 hover:bg-slate-800 rounded-lg"
              title="Sair"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 flex-grow w-full">

        {/* Intro / Search Section */}
        <section className="max-w-5xl mx-auto mb-8 text-center">
          {results.length === 0 && !isLoading && (
            <>
              <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">
                Inteligência Comercial Automatizada
              </h2>
              <p className="text-slate-400 mb-8 text-lg">
                Encontre, verifique e filtre leads de negócios usando verificação em tempo real e análise de NLP.
              </p>
            </>
          )}

          {!hasKey && (
            <div className="mb-6 p-4 bg-amber-900/20 border border-amber-500/50 text-amber-200 rounded-lg text-sm flex items-center justify-center gap-2">
              <Key size={16} />
              <span>Chave API necessária.</span>
            </div>
          )}

          {/* Form Container */}
          <form onSubmit={handleSearch} className="bg-slate-900 p-3 rounded-2xl border border-slate-800 shadow-2xl relative z-10 mx-auto w-full">
            <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1px_1.5fr_1px_auto_auto] gap-3 md:gap-0 items-center">

              {/* Input: Segmento */}
              <div className="relative group w-full">
                {isSweepMode ? (
                  <Globe2 className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500 animate-pulse" size={20} />
                ) : (
                  <Database className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-brand-500 transition-colors" size={20} />
                )}
                <input
                  type="text"
                  value={segment}
                  onChange={(e) => setSegment(e.target.value)}
                  placeholder="Segmento (Deixe vazio p/ Varredura)"
                  className="w-full bg-transparent border-none text-white placeholder-slate-500 focus:ring-0 h-12 pl-10 pr-4 text-base"
                  disabled={isLoading}
                />
                {isSweepMode && (
                  <span className="hidden lg:inline absolute right-0 -top-8 text-[10px] uppercase font-bold text-emerald-500 border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 rounded pointer-events-none shadow-sm shadow-emerald-500/10">
                    Modo Varredura
                  </span>
                )}
              </div>

              {/* Divider Desktop */}
              <div className="hidden md:block h-8 bg-slate-700 w-px mx-2"></div>

              {/* Input: Região */}
              <div className="relative group w-full">
                <MapPin className={`absolute left-3 top-1/2 -translate-y-1/2 transition-colors z-10 ${searchCoords ? 'text-emerald-400' : 'text-slate-500 group-focus-within:text-brand-500'}`} size={20} />
                <AddressAutocomplete
                  value={region}
                  onChange={handleRegionChange}
                  onLocationSelect={handleLocationSelect}
                  placeholder="Ex: Av. Paulista, SP ou Bairro Savassi"
                  disabled={isLoading}
                  className="w-full bg-transparent border-none text-white placeholder-slate-500 focus:ring-0 h-12 pl-10 pr-4 text-base"
                />
              </div>

              {/* Divider Desktop */}
              <div className="hidden md:block h-8 bg-slate-700 w-px mx-2"></div>

              {/* Select: Quantidade */}
              <div className="relative group w-full md:w-36 bg-slate-800/50 md:bg-transparent rounded-lg md:rounded-none border border-slate-700 md:border-none">
                <ListFilter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
                <select
                  value={maxResults}
                  onChange={(e) => setMaxResults(Number(e.target.value))}
                  className="w-full bg-transparent border-none text-white focus:ring-0 h-12 pl-10 pr-8 appearance-none cursor-pointer text-base"
                  disabled={isLoading}
                >
                  <option value={20} className="bg-slate-900">20 leads</option>
                  <option value={50} className="bg-slate-900">50 leads</option>
                  <option value={80} className="bg-slate-900">80 leads</option>
                  <option value={100} className="bg-slate-900">100 leads</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                  <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
              </div>

              {/* Button */}
              <button
                type="submit"
                disabled={isLoading || !region}
                className={`ml-0 md:ml-2 mt-2 md:mt-0 px-6 h-12 rounded-xl font-bold transition-all flex items-center justify-center gap-2 w-full md:w-auto whitespace-nowrap shadow-lg ${isSweepMode
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/20'
                  : 'bg-brand-600 hover:bg-brand-500 text-white shadow-brand-500/20'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {isLoading ? (
                  <div className="flex items-center gap-2" onClick={(e) => { e.preventDefault(); handleStopSearch(); }}>
                    <Loader2 className="animate-spin" size={20} />
                    <span>Parar</span>
                  </div>
                ) : (
                  <>
                    {isSweepMode ? <Globe2 size={20} /> : <Search size={20} />}
                    <span>{isSweepMode ? 'Escanear' : 'Buscar'}</span>
                  </>
                )}
              </button>

              {/* Search History */}
              <SearchHistory
                onSelectSearch={(seg, reg) => {
                  setSegment(seg);
                  setRegion(reg);
                }}
              />
            </div>
          </form>

          {/* Dicas de Busca (Só aparece se não houver resultados) */}
          {results.length === 0 && !isLoading && (
            <div className="mt-6 flex flex-col items-center animate-fadeIn">
              <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 max-w-2xl w-full text-left backdrop-blur-sm">
                <div className="flex items-center gap-2 text-brand-400 mb-2 font-semibold">
                  <Lightbulb size={16} className={isSweepMode ? "text-emerald-400" : "text-brand-400"} />
                  <span className={isSweepMode ? "text-emerald-400" : "text-brand-400"}>
                    Dicas para {isSweepMode ? "Varredura" : "Busca"}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs md:text-sm text-slate-400">
                  <div className="space-y-2">
                    <p className="flex items-start gap-2">
                      <span className="bg-slate-800 p-0.5 rounded text-slate-300 font-bold shrink-0">1</span>
                      {isSweepMode
                        ? <span><strong>Especifique a via:</strong> Selecione o endereço exato no menu para que a IA busque <strong>apenas</strong> naquele local (matchType: EXACT).</span>
                        : <span><strong>Seja específico:</strong> Ao invés de "Comércio", tente "Padarias Artesanais".</span>
                      }
                    </p>
                  </div>
                  <div className="space-y-2 border-l border-slate-800 pl-4">
                    <p className="flex items-start gap-2">
                      <Info size={14} className="mt-0.5 text-slate-500 shrink-0" />
                      <span>A IA prioriza empresas com <strong>rastros digitais recentes</strong>.</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Error Display */}
        {error && (
          <div className="max-w-3xl mx-auto mb-8 p-4 bg-red-900/20 border border-red-500/50 rounded-lg text-red-200 flex items-start gap-3 animate-fadeIn">
            <div className="mt-1"><AlertIcon /></div>
            <div>
              <h3 className="font-bold">A busca falhou</h3>
              <p className="text-sm opacity-90">{error}</p>
            </div>
          </div>
        )}

        {/* Progress Console (Sticky or Floating) */}
        {isLoading && (
          <div className="max-w-2xl mx-auto mb-8 animate-fadeIn">
            <div className="bg-slate-900 rounded-lg border border-slate-700 p-4 font-mono text-sm shadow-inner flex flex-col gap-2">
              <div className="flex items-center justify-between text-brand-400">
                <div className="flex items-center gap-2">
                  <Loader2 className="animate-spin" size={16} />
                  <span>PROCESSANDO_DADOS...</span>
                </div>
                <span className="text-slate-500 text-xs">{results.length} resultados encontrados</span>
              </div>
              <p className="text-slate-300">{`> ${progressMsg}`}</p>
              <div className="w-full bg-slate-800 rounded-full h-1 mt-1 overflow-hidden">
                <div className="bg-brand-500 h-1 rounded-full animate-progress"></div>
              </div>
            </div>
          </div>
        )}

        {/* Results Section */}
        {results.length > 0 && (
          <div className="animate-slideUp space-y-6 w-full">

            {/* Toggle View Components */}
            {viewMode === 'table' ? (
              <ResultsTable data={results} />
            ) : (
              <KanbanBoard data={results} onStageChange={handlePipelineChange} />
            )}

            {/* Map Component (Moved to bottom) */}
            <ResultsMap data={results} />

          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-900 mt-auto py-4 text-center text-slate-500 text-xs flex justify-between px-8 items-center">
        <p>&copy; {new Date().getFullYear()} VeriCorp. Inteligência gerada por IA.</p>

        <div className="flex items-center gap-4">
          {/* Botão de Limpar Cache */}
          <button
            onClick={handleClearCache}
            className={`flex items-center gap-1.5 transition-colors px-2 py-1 rounded border ${cacheCleaned
              ? 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10'
              : 'text-slate-500 border-slate-800 hover:text-slate-300 hover:bg-slate-800'
              }`}
            title="Limpar memória de busca"
          >
            {cacheCleaned ? <Check size={12} /> : <Trash2 size={12} />}
            <span>{cacheCleaned ? 'Cache Limpo!' : 'Limpar Cache'}</span>
          </button>

          <div className="flex items-center gap-2">
            <span>Status BD:</span>
            <span className={`flex items-center gap-1 ${dbStatus === 'online' ? 'text-emerald-500' : dbStatus === 'loading' ? 'text-slate-500' : 'text-amber-500'}`}>
              <div className={`w-2 h-2 rounded-full ${dbStatus === 'online' ? 'bg-emerald-500' : dbStatus === 'loading' ? 'bg-slate-500' : 'bg-amber-500'}`} />
              {dbStatus === 'online' ? 'Online (Supabase)' : dbStatus === 'loading' ? 'Verificando...' : 'Modo Offline (Local)'}
            </span>
          </div>
        </div>
      </footer>

      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
      <LeadListsManager isOpen={showLeadLists} onClose={() => setShowLeadLists(false)} />
      <Dashboard isOpen={showDashboard} onClose={() => setShowDashboard(false)} prospects={prospects} />
      <MessageTemplates isOpen={showTemplates} onClose={() => setShowTemplates(false)} />
    </div>
  );
};

const AlertIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
);

export default App;