import React, { useState, useEffect } from 'react';
import { searchHistoryService, SearchHistoryItem } from '../services/dbService';
import { History, Trash2, Search, Clock, MapPin, RefreshCw } from 'lucide-react';

interface SearchHistoryProps {
    onSelectSearch: (segment: string, region: string) => void;
}

export const SearchHistory: React.FC<SearchHistoryProps> = ({ onSelectSearch }) => {
    const [history, setHistory] = useState<SearchHistoryItem[]>([]);
    const [isOpen, setIsOpen] = useState(false);

    const loadHistory = async () => {
        const data = await searchHistoryService.getHistory(10);
        setHistory(data);
    };

    useEffect(() => {
        if (isOpen) {
            loadHistory();
        }
    }, [isOpen]);

    const handleClearHistory = async () => {
        await searchHistoryService.clearHistory();
        setHistory([]);
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffMins < 60) return `${diffMins} min atrás`;
        if (diffHours < 24) return `${diffHours}h atrás`;
        if (diffDays < 7) return `${diffDays}d atrás`;
        return date.toLocaleDateString('pt-BR');
    };

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors border ${isOpen
                        ? 'bg-brand-600 text-white border-brand-500'
                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white hover:bg-slate-700'
                    }`}
            >
                <History size={16} />
                <span className="hidden sm:inline">Histórico</span>
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 mt-2 w-80 bg-slate-800 rounded-xl border border-slate-700 shadow-2xl z-50 overflow-hidden animate-fadeIn">
                    {/* Header */}
                    <div className="flex items-center justify-between p-3 bg-slate-900/50 border-b border-slate-700">
                        <div className="flex items-center gap-2 text-slate-300">
                            <History size={16} />
                            <span className="font-medium">Buscas Recentes</span>
                        </div>
                        {history.length > 0 && (
                            <button
                                onClick={handleClearHistory}
                                className="text-xs text-slate-500 hover:text-red-400 flex items-center gap-1 transition-colors"
                            >
                                <Trash2 size={12} />
                                Limpar
                            </button>
                        )}
                    </div>

                    {/* List */}
                    <div className="max-h-64 overflow-y-auto custom-scrollbar">
                        {history.length === 0 ? (
                            <div className="p-6 text-center text-slate-500">
                                <Search className="mx-auto mb-2 opacity-50" size={24} />
                                <p className="text-sm">Nenhuma busca recente</p>
                            </div>
                        ) : (
                            <ul className="divide-y divide-slate-700/50">
                                {history.map((item) => (
                                    <li key={item.id}>
                                        <button
                                            onClick={() => {
                                                onSelectSearch(item.segment === 'Varredura Geral' ? '' : item.segment, item.region);
                                                setIsOpen(false);
                                            }}
                                            className="w-full text-left p-3 hover:bg-slate-700/50 transition-colors group"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm text-white font-medium truncate flex items-center gap-1.5">
                                                        <Search size={12} className="text-brand-400 shrink-0" />
                                                        {item.segment}
                                                    </p>
                                                    <p className="text-xs text-slate-400 truncate flex items-center gap-1 mt-0.5">
                                                        <MapPin size={10} className="shrink-0" />
                                                        {item.region}
                                                    </p>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <p className="text-xs text-slate-500 flex items-center gap-1">
                                                        <Clock size={10} />
                                                        {formatDate(item.createdAt)}
                                                    </p>
                                                    <p className="text-xs text-emerald-400">{item.resultsCount} resultados</p>
                                                </div>
                                            </div>
                                            <div className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <span className="text-[10px] text-brand-400 flex items-center gap-1">
                                                    <RefreshCw size={8} />
                                                    Clique para refazer busca
                                                </span>
                                            </div>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            )}

            {/* Click outside to close */}
            {isOpen && (
                <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsOpen(false)}
                />
            )}
        </div>
    );
};
