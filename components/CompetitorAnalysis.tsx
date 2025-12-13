import React from 'react';
import { CompetitorAnalysis as CompetitorAnalysisType } from '../types';
import { Target, TrendingUp, TrendingDown, Shield } from 'lucide-react';

interface CompetitorAnalysisProps {
    analysis: CompetitorAnalysisType;
}

export const CompetitorAnalysis: React.FC<CompetitorAnalysisProps> = ({ analysis }) => {
    if (!analysis) return null;

    return (
        <div className="space-y-4 animate-fadeIn">
            <div className="bg-slate-900/50 p-3 rounded border border-slate-700/50 flex items-start gap-3">
                <Target className="text-brand-400 shrink-0 mt-1" size={18} />
                <div>
                    <h5 className="text-sm font-bold text-slate-200">Resumo do Mercado</h5>
                    <p className="text-sm text-slate-400">{analysis.marketSummary}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {analysis.competitors.map((comp, idx) => (
                    <div key={idx} className="bg-slate-900 rounded border border-slate-800 p-4 hover:border-brand-500/30 transition-colors">
                        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-800">
                            <div className="w-8 h-8 rounded bg-slate-800 flex items-center justify-center font-bold text-slate-500">
                                {idx + 1}
                            </div>
                            <h4 className="font-bold text-slate-200 text-sm truncate" title={comp.name}>{comp.name}</h4>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <span className="text-[10px] uppercase font-bold text-emerald-500 flex items-center gap-1 mb-1">
                                    <TrendingUp size={10} /> Pontos Fortes
                                </span>
                                <ul className="text-xs text-slate-400 list-disc list-inside">
                                    {comp.strengths.slice(0, 2).map((s, i) => <li key={i}>{s}</li>)}
                                </ul>
                            </div>

                            <div>
                                <span className="text-[10px] uppercase font-bold text-red-400 flex items-center gap-1 mb-1">
                                    <TrendingDown size={10} /> Pontos Fracos
                                </span>
                                <ul className="text-xs text-slate-400 list-disc list-inside">
                                    {comp.weaknesses.slice(0, 2).map((w, i) => <li key={i}>{w}</li>)}
                                </ul>
                            </div>

                            <div className="bg-slate-800/50 p-2 rounded">
                                <span className="text-[10px] uppercase font-bold text-amber-500 flex items-center gap-1 mb-1">
                                    <Shield size={10} /> Diferencial
                                </span>
                                <p className="text-xs text-slate-300 italic">"{comp.differentiator}"</p>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <p className="text-[10px] text-slate-600 text-center italic mt-2">
                * Análise gerada por IA baseada em dados públicos disponíveis.
            </p>
        </div>
    );
};
