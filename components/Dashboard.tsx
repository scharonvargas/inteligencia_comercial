import React, { useState, useEffect } from 'react';
import { searchHistoryService, SearchHistoryItem, leadListService, LeadList, rateLimitService } from '../services/dbService';
import { dbService } from '../services/dbService';
import { BusinessEntity } from '../types';
import {
    BarChart3, TrendingUp, Users, Search, Calendar,
    Target, CheckCircle, Clock, X
} from 'lucide-react';

interface DashboardProps {
    isOpen: boolean;
    onClose: () => void;
    prospects: BusinessEntity[];
}

export const Dashboard: React.FC<DashboardProps> = ({ isOpen, onClose, prospects }) => {
    const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
    const [lists, setLists] = useState<LeadList[]>([]);
    const [rateLimit, setRateLimit] = useState({ used: 0, remaining: 50, limit: 50 });

    useEffect(() => {
        if (isOpen) {
            loadData();
        }
    }, [isOpen]);

    const loadData = async () => {
        const history = await searchHistoryService.getHistory(20);
        setSearchHistory(history);

        const allLists = await leadListService.getLists();
        setLists(allLists);

        const limit = await rateLimitService.getSearchCount();
        setRateLimit(limit);
    };

    if (!isOpen) return null;

    // Calculate stats
    const totalSearches = searchHistory.length;
    const totalResults = searchHistory.reduce((sum, h) => sum + h.resultsCount, 0);
    const avgResultsPerSearch = totalSearches > 0 ? Math.round(totalResults / totalSearches) : 0;

    // Get searches by day (last 7 days)
    const last7Days = Array.from({ length: 7 }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - i));
        return date.toISOString().split('T')[0];
    });

    const searchesByDay = last7Days.map(day => {
        const count = searchHistory.filter(h => h.createdAt.startsWith(day)).length;
        return { day: day.slice(5), count }; // Format: MM-DD
    });

    const maxSearches = Math.max(...searchesByDay.map(d => d.count), 1);

    // Prospects by stage
    const stages = {
        new: prospects.filter(p => p.pipelineStage === 'new' || !p.pipelineStage).length,
        contacting: prospects.filter(p => p.pipelineStage === 'contacting').length,
        negotiating: prospects.filter(p => p.pipelineStage === 'negotiating').length,
        won: prospects.filter(p => p.pipelineStage === 'won').length,
        lost: prospects.filter(p => p.pipelineStage === 'lost').length,
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn p-4">
            <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-4xl shadow-2xl max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-700 bg-slate-900/50">
                    <div className="flex items-center gap-2 text-white">
                        <BarChart3 size={24} className="text-brand-400" />
                        <h2 className="text-lg font-semibold">Dashboard de Performance</h2>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-gradient-to-br from-brand-600/20 to-brand-600/5 rounded-xl p-4 border border-brand-500/20">
                            <div className="flex items-center gap-2 text-brand-400 mb-2">
                                <Search size={18} />
                                <span className="text-xs uppercase tracking-wide">Buscas Hoje</span>
                            </div>
                            <p className="text-2xl font-bold text-white">{rateLimit.used}</p>
                            <p className="text-xs text-slate-400">{rateLimit.remaining} restantes</p>
                        </div>

                        <div className="bg-gradient-to-br from-emerald-600/20 to-emerald-600/5 rounded-xl p-4 border border-emerald-500/20">
                            <div className="flex items-center gap-2 text-emerald-400 mb-2">
                                <Users size={18} />
                                <span className="text-xs uppercase tracking-wide">Prospects</span>
                            </div>
                            <p className="text-2xl font-bold text-white">{prospects.length}</p>
                            <p className="text-xs text-slate-400">leads salvos</p>
                        </div>

                        <div className="bg-gradient-to-br from-amber-600/20 to-amber-600/5 rounded-xl p-4 border border-amber-500/20">
                            <div className="flex items-center gap-2 text-amber-400 mb-2">
                                <TrendingUp size={18} />
                                <span className="text-xs uppercase tracking-wide">Média</span>
                            </div>
                            <p className="text-2xl font-bold text-white">{avgResultsPerSearch}</p>
                            <p className="text-xs text-slate-400">resultados/busca</p>
                        </div>

                        <div className="bg-gradient-to-br from-violet-600/20 to-violet-600/5 rounded-xl p-4 border border-violet-500/20">
                            <div className="flex items-center gap-2 text-violet-400 mb-2">
                                <Target size={18} />
                                <span className="text-xs uppercase tracking-wide">Listas</span>
                            </div>
                            <p className="text-2xl font-bold text-white">{lists.length}</p>
                            <p className="text-xs text-slate-400">categorias</p>
                        </div>
                    </div>

                    {/* Charts Row */}
                    <div className="grid md:grid-cols-2 gap-6">
                        {/* Searches Chart */}
                        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700">
                            <h3 className="text-sm font-medium text-slate-300 mb-4 flex items-center gap-2">
                                <Calendar size={16} />
                                Buscas nos Últimos 7 Dias
                            </h3>
                            <div className="flex items-end justify-between h-32 gap-2">
                                {searchesByDay.map((item, i) => (
                                    <div key={i} className="flex-1 flex flex-col items-center">
                                        <div
                                            className="w-full bg-brand-500/30 rounded-t transition-all hover:bg-brand-500/50"
                                            style={{ height: `${(item.count / maxSearches) * 100}%`, minHeight: item.count > 0 ? '8px' : '2px' }}
                                        />
                                        <span className="text-[10px] text-slate-500 mt-2">{item.day}</span>
                                        <span className="text-xs text-brand-400">{item.count}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Pipeline Chart */}
                        <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700">
                            <h3 className="text-sm font-medium text-slate-300 mb-4 flex items-center gap-2">
                                <Target size={16} />
                                Pipeline de Leads
                            </h3>
                            <div className="space-y-3">
                                {[
                                    { label: 'Novos', value: stages.new, color: 'bg-slate-500', icon: Clock },
                                    { label: 'Contactando', value: stages.contacting, color: 'bg-amber-500', icon: Users },
                                    { label: 'Negociando', value: stages.negotiating, color: 'bg-brand-500', icon: TrendingUp },
                                    { label: 'Fechados', value: stages.won, color: 'bg-emerald-500', icon: CheckCircle },
                                ].map((stage) => {
                                    const total = prospects.length || 1;
                                    const percentage = Math.round((stage.value / total) * 100);
                                    return (
                                        <div key={stage.label} className="flex items-center gap-3">
                                            <stage.icon size={14} className="text-slate-400 shrink-0" />
                                            <span className="text-xs text-slate-400 w-20">{stage.label}</span>
                                            <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full ${stage.color} rounded-full transition-all`}
                                                    style={{ width: `${percentage}%` }}
                                                />
                                            </div>
                                            <span className="text-xs text-white w-10 text-right">{stage.value}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Recent Activity */}
                    <div className="mt-6 bg-slate-900/50 rounded-xl p-4 border border-slate-700">
                        <h3 className="text-sm font-medium text-slate-300 mb-4 flex items-center gap-2">
                            <Clock size={16} />
                            Atividade Recente
                        </h3>
                        <div className="space-y-2 max-h-40 overflow-y-auto">
                            {searchHistory.slice(0, 5).map((item) => (
                                <div key={item.id} className="flex items-center justify-between py-2 border-b border-slate-700/50 last:border-0">
                                    <div className="flex items-center gap-2">
                                        <Search size={12} className="text-brand-400" />
                                        <span className="text-sm text-white">{item.segment}</span>
                                        <span className="text-xs text-slate-500">em {item.region}</span>
                                    </div>
                                    <span className="text-xs text-emerald-400">{item.resultsCount} resultados</span>
                                </div>
                            ))}
                            {searchHistory.length === 0 && (
                                <p className="text-sm text-slate-500 text-center py-4">Nenhuma atividade recente</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
