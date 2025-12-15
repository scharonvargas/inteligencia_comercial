import React, { useState, useEffect } from 'react';
import { BusinessEntity, PipelineStage } from '../types';
import { dbService } from '../services/dbService';
import { Phone, Mail, MapPin, MoreHorizontal, ArrowRight, CheckCircle, XCircle, Clock, Calendar } from 'lucide-react';
import { LeadDetailsModal } from './LeadDetailsModal';

interface KanbanViewProps {
    prospects: BusinessEntity[];
    onMove: (businessId: string, newStage: PipelineStage) => void;
}

const STAGES: { id: PipelineStage; label: string; color: string }[] = [
    { id: 'new', label: 'Novos Leads', color: 'border-blue-500' },
    { id: 'contacted', label: 'Contactados', color: 'border-amber-500' },
    { id: 'meeting', label: 'Reunião Agendada', color: 'border-purple-500' },
    { id: 'closed', label: 'Fechado (Ganho)', color: 'border-emerald-500' },
    { id: 'lost', label: 'Perdido', color: 'border-slate-500' }
];

export const KanbanView: React.FC<KanbanViewProps> = ({ prospects, onMove }) => {
    const [columns, setColumns] = useState<Record<PipelineStage, BusinessEntity[]>>({
        new: [], contacted: [], meeting: [], closed: [], lost: []
    });
    const [selectedBusiness, setSelectedBusiness] = useState<BusinessEntity | null>(null);

    useEffect(() => {
        const cols: Record<PipelineStage, BusinessEntity[]> = {
            new: [], contacted: [], meeting: [], closed: [], lost: []
        };
        prospects.forEach(p => {
            const stage = p.pipelineStage || 'new';
            if (cols[stage]) cols[stage].push(p);
            else cols['new'].push(p); // Fallback
        });
        setColumns(cols);
    }, [prospects]);

    const handleMove = async (business: BusinessEntity, newStage: PipelineStage) => {
        // Optimistic update
        setColumns(prev => {
            const sourceStage = business.pipelineStage || 'new';
            const sourceList = prev[sourceStage].filter(b => b.id !== business.id);
            const targetList = [...prev[newStage], { ...business, pipelineStage: newStage }];
            return { ...prev, [sourceStage]: sourceList, [newStage]: targetList };
        });

        onMove(business.id, newStage);
    };

    return (
        <div className="flex gap-4 overflow-x-auto pb-4 h-[calc(100vh-200px)] min-h-[500px]">
            {STAGES.map(stage => (
                <div key={stage.id} className="min-w-[280px] w-[280px] flex flex-col bg-slate-900/50 rounded-lg border border-slate-800">
                    {/* Header */}
                    <div className={`p-3 border-t-2 ${stage.color} bg-slate-900 rounded-t-lg flex justify-between items-center sticky top-0 z-10`}>
                        <h3 className="font-bold text-slate-200 text-sm uppercase tracking-wide">{stage.label}</h3>
                        <span className="bg-slate-800 text-slate-400 text-xs px-2 py-0.5 rounded-full font-mono">
                            {columns[stage.id]?.length || 0}
                        </span>
                    </div>

                    {/* List */}
                    <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
                        {columns[stage.id]?.map(biz => (
                            <div
                                key={biz.id}
                                onClick={() => setSelectedBusiness(biz)}
                                className="bg-slate-800 p-3 rounded border border-slate-700 hover:border-slate-600 hover:bg-slate-750 cursor-pointer transition-all shadow-sm group active:scale-[0.98]"
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <h4 className="font-bold text-slate-200 text-sm truncate w-full" title={biz.name}>{biz.name}</h4>
                                </div>

                                <div className="space-y-1 mb-3">
                                    <p className="text-xs text-slate-400 flex items-center gap-2 truncate">
                                        <MapPin size={10} className="shrink-0" /> {biz.address}
                                    </p>
                                    {(biz.notes?.length || 0) > 0 && (
                                        <p className="text-[10px] text-indigo-400 flex items-center gap-1 mt-1">
                                            <MoreHorizontal size={10} /> {biz.notes?.length} notas
                                        </p>
                                    )}
                                </div>

                                {/* Footer / Actions */}
                                <div className="pt-2 border-t border-slate-700 flex justify-between items-center" onClick={e => e.stopPropagation()}>
                                    <div className="flex items-center gap-1">
                                        {biz.viabilityScore && (
                                            <div className={`w-2 h-2 rounded-full ${biz.viabilityScore > 70 ? 'bg-emerald-500' : 'bg-amber-500'}`} title={`Score: ${biz.viabilityScore}`} />
                                        )}
                                        <span className="text-[10px] text-slate-500 truncate max-w-[80px]">{biz.category}</span>
                                    </div>

                                    <select
                                        className="bg-slate-900 border border-slate-700 text-[10px] text-slate-300 rounded px-1 py-0.5 focus:outline-none focus:border-brand-500 cursor-pointer"
                                        value={stage.id}
                                        onChange={(e) => handleMove(biz, e.target.value as PipelineStage)}
                                    >
                                        <option value="new">Novo</option>
                                        <option value="contacted">Contactado</option>
                                        <option value="meeting">Reunião</option>
                                        <option value="closed">Fechado</option>
                                        <option value="lost">Perdido</option>
                                    </select>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ))}

            <LeadDetailsModal
                isOpen={!!selectedBusiness}
                business={selectedBusiness}
                onClose={() => setSelectedBusiness(null)}
                onUpdate={() => {
                    // Since parent handles updates via onMove which triggers re-render, 
                    // just closing modal or ensuring parent re-fetches might be needed.
                    // Ideally we propagate this up, but for now parent might not auto-refresh deeply nested props changes (like notes).
                    // We might need a generic onRefresh prop from App.tsx or just rely on local state update if we were smarter.
                    // For V1, let's trigger a page refresh or assume the user will reload if they want to see notes in the card preview immediately.
                    // Actually, we should call a sync function. But onMove is for stage.
                    // Let's pass a dummy for now or improve App.tsx to generic update.
                    // We will force a re-fetch in App.tsx by passing a refresh callback if we had one.
                    // For now, assume global state or context would handle this better. 
                    // We can just rely on the modal updating the local object it holds. 
                }}
            />
        </div>
    );
};
