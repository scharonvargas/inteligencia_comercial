import React, { useMemo, useState, useEffect } from 'react';
import { BusinessEntity } from '../types';
import { GripVertical, Phone, ExternalLink, MapPin, Calendar, AlertCircle, ArrowRight } from 'lucide-react';

interface KanbanBoardProps {
  data: BusinessEntity[];
  onStageChange: (businessId: string, newStage: string) => void;
}

// Configuração estendida para suportar cores dinâmicas no Drag & Drop
const COLUMNS = [
  { 
    id: 'new', 
    title: 'Novos', 
    headerStyle: 'border-blue-500/50 bg-blue-500/5', 
    activeStyle: 'border-blue-500 bg-blue-500/10 shadow-[0_0_25px_rgba(59,130,246,0.2)] ring-blue-500/30',
    iconColor: 'text-blue-400',
    badgeColor: 'bg-blue-600'
  },
  { 
    id: 'qualified', 
    title: 'Qualificados', 
    headerStyle: 'border-emerald-500/50 bg-emerald-500/5', 
    activeStyle: 'border-emerald-500 bg-emerald-500/10 shadow-[0_0_25px_rgba(16,185,129,0.2)] ring-emerald-500/30',
    iconColor: 'text-emerald-400',
    badgeColor: 'bg-emerald-600'
  },
  { 
    id: 'contacted', 
    title: 'Em Contato', 
    headerStyle: 'border-amber-500/50 bg-amber-500/5', 
    activeStyle: 'border-amber-500 bg-amber-500/10 shadow-[0_0_25px_rgba(245,158,11,0.2)] ring-amber-500/30',
    iconColor: 'text-amber-400',
    badgeColor: 'bg-amber-600'
  },
  { 
    id: 'discarded', 
    title: 'Descartados', 
    headerStyle: 'border-red-500/50 bg-red-500/5', 
    activeStyle: 'border-red-500 bg-red-500/10 shadow-[0_0_25px_rgba(239,68,68,0.2)] ring-red-500/30',
    iconColor: 'text-red-400',
    badgeColor: 'bg-red-600'
  },
];

const STORAGE_KEY = 'vericorp_kanban_stages';

export const KanbanBoard: React.FC<KanbanBoardProps> = ({ data, onStageChange }) => {
  const [activeCol, setActiveCol] = useState<string | null>(null);
  const [sourceCol, setSourceCol] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  
  // Cache local para persistência de estágios
  const [localStages, setLocalStages] = useState<Record<string, string>>({});

  // Carregar estágios salvos ao montar
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setLocalStages(JSON.parse(saved));
      }
    } catch (e) {
      console.warn('Falha ao carregar estado do Kanban:', e);
    }
  }, []);

  // Organiza os dados em colunas, mesclando dados da API com cache local
  const columnsData = useMemo(() => {
    const cols: Record<string, BusinessEntity[]> = {
      new: [],
      qualified: [],
      contacted: [],
      discarded: []
    };

    data.forEach(biz => {
      const savedStage = localStages[biz.id];
      const stage = savedStage || biz.pipelineStage || 'new';
      
      if (cols[stage]) {
        cols[stage].push({ ...biz, pipelineStage: stage });
      } else {
        cols['new'].push({ ...biz, pipelineStage: 'new' });
      }
    });

    return cols;
  }, [data, localStages]);

  // Handlers de Drag and Drop
  const handleDragStart = (e: React.DragEvent, id: string, colId: string) => {
    setDraggedId(id);
    setSourceCol(colId);
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    
    // Tenta definir uma imagem de drag vazia ou customizada se necessário, 
    // mas aqui confiamos no ghost padrão do navegador, focando em estilizar o "slot" de origem.
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setActiveCol(null);
    setSourceCol(null);
  };

  const handleDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (activeCol !== colId) {
      setActiveCol(colId);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Opcional: lógica para limpar activeCol se sair do container pai
  };

  const handleDrop = (e: React.DragEvent, targetStage: string) => {
    e.preventDefault();
    const businessId = e.dataTransfer.getData('text/plain');
    
    if (businessId) {
      const newLocalStages = { ...localStages, [businessId]: targetStage };
      setLocalStages(newLocalStages);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newLocalStages));
      onStageChange(businessId, targetStage);
    }
    
    setActiveCol(null);
    setDraggedId(null);
    setSourceCol(null);
  };

  return (
    <div className="flex flex-col md:flex-row gap-4 h-[calc(100vh-250px)] overflow-x-auto pb-4 custom-scrollbar">
      {COLUMNS.map(col => {
        const isActive = activeCol === col.id;
        const items = columnsData[col.id] || [];
        const isEmpty = items.length === 0;

        return (
          <div 
            key={col.id} 
            className={`
              flex-1 min-w-[300px] flex flex-col rounded-xl border transition-all duration-300
              ${isActive 
                ? `${col.activeStyle} ring-2 scale-[1.01]` 
                : 'bg-slate-900/50 border-slate-800'
              }
            `}
            onDragOver={(e) => handleDragOver(e, col.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col.id)}
          >
            {/* Column Header */}
            <div className={`p-4 border-b-2 ${col.headerStyle} flex justify-between items-center bg-slate-800/50 rounded-t-xl`}>
              <h3 className={`font-bold ${isActive ? col.iconColor : 'text-slate-200'} transition-colors`}>
                {col.title}
              </h3>
              <span className={`text-xs px-2 py-1 rounded-full font-mono font-bold text-white transition-colors ${
                 isActive ? col.badgeColor : 'bg-slate-700'
              }`}>
                {items.length}
              </span>
            </div>

            {/* Column Body */}
            <div className={`flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar transition-all duration-300 ${
              isActive ? 'bg-slate-900/10' : ''
            }`}>
              {items.map(biz => {
                const isDragging = draggedId === biz.id;
                // Blur siblings: Se algo está sendo arrastado desta coluna, desfoca os outros itens
                const isSiblingInSource = draggedId !== null && sourceCol === col.id && !isDragging;
                
                return (
                  <div
                    key={biz.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, biz.id, col.id)}
                    onDragEnd={handleDragEnd}
                    className={`
                      relative p-4 rounded-lg border cursor-grab active:cursor-grabbing transition-all duration-300 group
                      ${isDragging 
                        ? 'opacity-40 border-2 border-dashed border-slate-500/50 bg-slate-900/30 shadow-inner scale-[0.98]' 
                        : `bg-slate-800 border-slate-700 hover:border-slate-500 hover:shadow-lg ${isActive ? '' : 'hover:-translate-y-1'}`
                      }
                      ${isSiblingInSource ? 'blur-[1px] opacity-70 grayscale-[0.3] scale-[0.99]' : ''}
                    `}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <h4 className={`font-bold text-sm line-clamp-2 pr-4 transition-colors ${isDragging ? 'text-slate-500' : 'text-slate-200'}`}>
                        {biz.name}
                      </h4>
                      {!isDragging && (
                        <GripVertical size={16} className="shrink-0 text-slate-600 group-hover:text-brand-500 transition-colors" />
                      )}
                    </div>
                    
                    <p className="text-xs text-slate-500 mb-3 line-clamp-1">{biz.category}</p>

                    {/* Tags e Infos */}
                    {!isDragging && (
                      <>
                        <div className="flex flex-wrap gap-2 mb-3">
                          {biz.trustScore >= 80 && (
                            <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/20">
                              Alta Confiança
                            </span>
                          )}
                          {biz.daysSinceLastActivity <= 30 && biz.daysSinceLastActivity !== -1 && (
                            <span className="text-[10px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/20 flex items-center gap-1">
                              <Calendar size={10} /> Ativo
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-slate-700/50">
                          <div className="flex gap-2">
                              {biz.phone && (
                                <a 
                                  href={`https://wa.me/${biz.phone.replace(/\D/g,'')}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-slate-400 hover:text-emerald-400 transition-colors p-1 hover:bg-slate-700 rounded"
                                  title="WhatsApp"
                                  onMouseDown={(e) => e.stopPropagation()} 
                                >
                                  <Phone size={14} />
                                </a>
                              )}
                              {biz.website && (
                                <a 
                                  href={biz.website}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-slate-400 hover:text-blue-400 transition-colors p-1 hover:bg-slate-700 rounded"
                                  title="Website"
                                  onMouseDown={(e) => e.stopPropagation()}
                                >
                                  <ExternalLink size={14} />
                                </a>
                              )}
                              <div className="text-slate-400 hover:text-slate-200 cursor-help p-1" title={biz.address}>
                                <MapPin size={14} />
                              </div>
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono">
                              Score: {biz.trustScore}
                          </div>
                        </div>
                      </>
                    )}
                    
                    {/* Placeholder content when dragging */}
                    {isDragging && (
                       <div className="h-6 flex items-center justify-center">
                          <span className="text-xs text-slate-600 font-mono uppercase tracking-widest">Movendo...</span>
                       </div>
                    )}
                  </div>
                );
              })}
              
              {/* Empty State / Drop Placeholder */}
              {isEmpty && (
                <div className={`h-full flex flex-col items-center justify-center transition-all duration-500 min-h-[150px] rounded-lg border-2 border-dashed ${
                   isActive 
                    ? `border-current ${col.iconColor} bg-slate-800/40 opacity-100 scale-100` 
                    : 'border-slate-800 opacity-40'
                }`}>
                    <div className={`p-3 rounded-full mb-2 transition-transform duration-300 ${isActive ? 'bg-slate-800 scale-110 shadow-lg' : 'bg-slate-800/50'}`}>
                      {isActive ? <ArrowRight size={24} className="animate-pulse" /> : <AlertCircle size={24} />}
                    </div>
                    <span className={`text-xs font-medium ${isActive ? 'text-white' : 'text-slate-500'}`}>
                       {isActive ? 'Solte aqui' : 'Vazio'}
                    </span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};