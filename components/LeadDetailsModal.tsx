import React, { useState, useEffect } from 'react';
import { BusinessEntity, PipelineStage, Note, OutreachScripts, CompetitorAnalysis as CompetitorAnalysisType } from '../types';
import { dbService } from '../services/dbService';
import { generateOmnichannelScripts, analyzeCompetitors } from '../services/geminiService';
import { OutreachTabs } from './OutreachTabs';
import { CompetitorAnalysis } from './CompetitorAnalysis';
import { X, Phone, Mail, Globe, MapPin, Calendar, MessageSquare, Clock, Send, FileText, ChevronRight, Target } from 'lucide-react';

interface LeadDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    business: BusinessEntity | null;
    onUpdate: () => void; // Trigger refresh in parent
}

export const LeadDetailsModal: React.FC<LeadDetailsModalProps> = ({ isOpen, onClose, business, onUpdate }) => {
    const [activeTab, setActiveTab] = useState<'overview' | 'timeline' | 'scripts'>('overview');
    const [noteContent, setNoteContent] = useState('');
    const [localBusiness, setLocalBusiness] = useState<BusinessEntity | null>(null);
    const [scripts, setScripts] = useState<OutreachScripts | null>(null);
    const [loadingScripts, setLoadingScripts] = useState(false);
    const [competitorAnalysis, setCompetitorAnalysis] = useState<CompetitorAnalysisType | null>(null);
    const [loadingAnalysis, setLoadingAnalysis] = useState(false);

    useEffect(() => {
        if (business) {
            setLocalBusiness(business);
            // Reset states
            setScripts(null); // Could cache this in DB too eventually
            setCompetitorAnalysis(null);
        }
    }, [business]);

    if (!isOpen || !localBusiness) return null;

    const handleStageChange = async (newStage: PipelineStage) => {
        if (!localBusiness) return;

        // Optimistic UI
        setLocalBusiness(prev => prev ? { ...prev, pipelineStage: newStage } : null);

        await dbService.updatePipelineStage(localBusiness.id, newStage);
        onUpdate();
    };

    const handleAddNote = async () => {
        if (!noteContent.trim() || !localBusiness) return;

        await dbService.addNote(localBusiness.id, noteContent);
        setNoteContent('');

        // Refresh local entity to show new note immediately
        const updated = (await dbService.getAllProspects()).find(p => p.id === localBusiness.id);
        if (updated) setLocalBusiness(updated);

        onUpdate();
    };

    const loadScripts = async () => {
        if (!localBusiness) return;
        setLoadingScripts(true);
        try {
            // Mocking the generatedScripts state structure from ResultsTable if needed, 
            // or just calling service directly.
            const generated = await generateOmnichannelScripts(localBusiness);
            setScripts(generated);
        } catch (error) {
            console.error("Error generating scripts", error);
        } finally {
            setLoadingScripts(false);
        }
    };

    const loadAnalysis = async () => {
        if (!localBusiness) return;
        setLoadingAnalysis(true);
        try {
            const analysis = await analyzeCompetitors(localBusiness);
            setCompetitorAnalysis(analysis);
        } catch (error) {
            console.error("Error analyzing competitors", error);
        } finally {
            setLoadingAnalysis(false);
        }
    };

    // Combine history and notes for timeline
    const timelineItems = [
        ...(localBusiness.history || []).map(h => ({ ...h, _source: 'history' })),
        ...(localBusiness.notes || []).map(n => ({ ...n, _source: 'note' }))
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fadeIn">
            <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-4xl h-[90vh] flex flex-col shadow-2xl animate-slideUp">

                {/* Header */}
                <div className="p-6 border-b border-slate-800 flex justify-between items-start bg-slate-900 rounded-t-xl">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <h2 className="text-2xl font-bold text-white">{localBusiness.name}</h2>
                            <span className="px-2 py-0.5 rounded text-xs bg-slate-800 text-slate-400 border border-slate-700">
                                {localBusiness.category}
                            </span>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-slate-400">
                            {localBusiness.phone && <div className="flex items-center gap-1"><Phone size={14} /> {localBusiness.phone}</div>}
                            {localBusiness.website && <div className="flex items-center gap-1"><Globe size={14} /> {localBusiness.website}</div>}
                            <div className="flex items-center gap-1"><MapPin size={14} /> {localBusiness.address}</div>
                        </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                        <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                            <X size={24} />
                        </button>

                        <div className="flex items-center gap-2 bg-slate-800 p-1 rounded-lg border border-slate-700">
                            <span className="text-xs text-slate-400 px-2">Estágio:</span>
                            <select
                                value={localBusiness.pipelineStage || 'new'}
                                onChange={(e) => handleStageChange(e.target.value as PipelineStage)}
                                className="bg-slate-900 text-white text-sm border-none rounded py-1 px-2 focus:ring-1 focus:ring-brand-500 cursor-pointer"
                            >
                                <option value="new">Novos Leads</option>
                                <option value="contacted">Contactados</option>
                                <option value="meeting">Reunião</option>
                                <option value="closed">Fechado</option>
                                <option value="lost">Perdido</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* content */}
                <div className="flex-1 flex overflow-hidden">
                    {/* Left Sidebar - Navigation & Quick Info */}
                    <div className="w-64 bg-slate-950/50 border-r border-slate-800 p-4 flex flex-col gap-2">
                        <button
                            onClick={() => setActiveTab('overview')}
                            className={`flex items-center gap-3 p-3 rounded-lg text-sm font-medium transition-colors ${activeTab === 'overview' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
                        >
                            <FileText size={18} /> Resumo & IA
                        </button>
                        <button
                            onClick={() => setActiveTab('timeline')}
                            className={`flex items-center gap-3 p-3 rounded-lg text-sm font-medium transition-colors ${activeTab === 'timeline' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
                        >
                            <Clock size={18} /> Timeline & Notas
                        </button>
                        <button
                            onClick={() => setActiveTab('scripts')}
                            className={`flex items-center gap-3 p-3 rounded-lg text-sm font-medium transition-colors ${activeTab === 'scripts' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
                        >
                            <MessageSquare size={18} /> Scripts de Venda
                        </button>

                        <div className="mt-auto pt-4 border-t border-slate-800">
                            <div className="text-xs text-slate-500 mb-2">Viabilidade AI</div>
                            <div className="flex items-center gap-2 mb-1">
                                <div className={`text-xl font-bold ${(localBusiness.viabilityScore || 0) > 70 ? 'text-emerald-500' : 'text-amber-500'
                                    }`}>
                                    {localBusiness.viabilityScore || '?'}
                                </div>
                                <span className="text-xs text-slate-400">/ 100</span>
                            </div>
                            <p className="text-[10px] text-slate-500 leading-tight">
                                {localBusiness.viabilityReason || "Sem análise detalhada."}
                            </p>
                        </div>
                    </div>

                    {/* Main Content Area */}
                    <div className="flex-1 overflow-y-auto p-6 bg-slate-900/30">

                        {activeTab === 'overview' && (
                            <div className="space-y-6">
                                {/* Competitor Analysis Section */}
                                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="font-semibold text-white flex items-center gap-2">
                                            <Target size={18} className="text-brand-400" /> Análise Competitiva
                                        </h3>
                                        {!competitorAnalysis && (
                                            <button
                                                onClick={loadAnalysis}
                                                disabled={loadingAnalysis}
                                                className="text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
                                            >
                                                {loadingAnalysis ? 'Analisando...' : 'Gerar Análise'}
                                            </button>
                                        )}
                                    </div>

                                    {competitorAnalysis ? (
                                        <CompetitorAnalysis analysis={competitorAnalysis} />
                                    ) : (
                                        <div className="text-center py-8 text-slate-500 text-sm border border-dashed border-slate-700 rounded">
                                            Nenhuma análise gerada para este lead.
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === 'scripts' && (
                            <div className="space-y-6">
                                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="font-semibold text-white flex items-center gap-2">
                                            <MessageSquare size={18} className="text-brand-400" /> Scripts Omnichannel
                                        </h3>
                                        {!scripts && (
                                            <button
                                                onClick={loadScripts}
                                                disabled={loadingScripts}
                                                className="text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
                                            >
                                                {loadingScripts ? 'Criando Scripts...' : 'Gerar Scripts'}
                                            </button>
                                        )}
                                    </div>

                                    {scripts ? (
                                        <OutreachTabs
                                            businessName={localBusiness.name}
                                            scripts={scripts}
                                            phone={localBusiness.phone}
                                        />
                                    ) : (
                                        <div className="text-center py-8 text-slate-500 text-sm border border-dashed border-slate-700 rounded">
                                            Gere scripts personalizados para Email, WhatsApp e LinkedIn.
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === 'timeline' && (
                            <div className="flex flex-col h-full">
                                {/* New Note Input */}
                                <div className="mb-6 bg-slate-800 p-4 rounded-lg border border-slate-700">
                                    <label className="text-xs text-slate-400 font-semibold mb-2 block uppercase">Adicionar Nota</label>
                                    <div className="flex gap-2">
                                        <textarea
                                            value={noteContent}
                                            onChange={(e) => setNoteContent(e.target.value)}
                                            placeholder="Escreva detalhes sobre a interação..."
                                            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:ring-1 focus:ring-brand-500 focus:outline-none resize-none h-20"
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                    e.preventDefault();
                                                    handleAddNote();
                                                }
                                            }}
                                        />
                                        <button
                                            onClick={handleAddNote}
                                            disabled={!noteContent.trim()}
                                            className="px-4 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex flex-col items-center justify-center gap-1"
                                        >
                                            <Send size={18} />
                                            <span className="text-[10px] font-bold">SALVAR</span>
                                        </button>
                                    </div>
                                </div>

                                {/* Timeline List */}
                                <div className="space-y-4 pb-4">
                                    {timelineItems.length === 0 && (
                                        <div className="text-center text-slate-500 py-4 text-sm">Nenhum histórico registrado.</div>
                                    )}

                                    {timelineItems.map((item: any) => (
                                        <div key={item.id} className="flex gap-3 animate-fadeIn">
                                            <div className="flex flex-col items-center">
                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 shrink-0 ${(item as any)._source === 'note' ? 'bg-indigo-500/20 border-indigo-500 text-indigo-400' : 'bg-slate-700/50 border-slate-600 text-slate-400'
                                                    }`}>
                                                    {(item as any)._source === 'note' ? <FileText size={14} /> : <Clock size={14} />}
                                                </div>
                                                <div className="w-0.5 flex-1 bg-slate-800 my-1"></div>
                                            </div>
                                            <div className="flex-1 bg-slate-800/50 border border-slate-700 p-3 rounded-lg">
                                                <div className="flex justify-between items-start mb-1">
                                                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wide">
                                                        {(item as any)._source === 'note' ? 'Nota' : (item as any).type?.replace('_', ' ')}
                                                    </span>
                                                    <span className="text-[10px] text-slate-500">
                                                        {new Date(item.createdAt).toLocaleString()}
                                                    </span>
                                                </div>
                                                <p className="text-sm text-slate-300 whitespace-pre-wrap">
                                                    {(item as any).content || (item as any).description}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
