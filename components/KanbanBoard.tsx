
import React, { useMemo, useState } from 'react';
import { BusinessEntity } from '../types';
import { GripVertical, Phone, ExternalLink, MapPin, Calendar, AlertCircle, ArrowRight } from 'lucide-react';

interface KanbanBoardProps {
  data: BusinessEntity[];
  onStageChange: (businessId: string, newStage: string) => void;
}

const COLUMNS = [
  { id: 'new', title: 'Novos', color: 'border-blue-500/50 bg-blue-500/5', iconColor: 'text-blue-400' },
  { id: 'qualified', title: 'Qualificados', color: 'border-emerald-500/50 bg-emerald-500/5', iconColor: 'text-emerald-400' },
  { id: 'contacted', title: 'Em Contato', color: 'border-amber-500/50 bg-amber-500/5', iconColor: 'text-amber-400' },
  { id: 'discarded', title: 'Descartados', color: 'border-red-500/50 bg-red-500/5', iconColor: 'text-red-400' },
];

export const KanbanBoard: React.FC<KanbanBoardProps> = ({ data, onStageChange }) => {
  const [activeCol, setActiveCol] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  
  // Organiza os dados em colunas
  const columnsData = useMemo(() => {
    const cols: Record<string, BusinessEntity[]> = {
      new: [],
      qualified: [],
      contacted: [],
      discarded: []
    };

    data.forEach(biz => {
      const stage = biz.pipelineStage || 'new';
      if (cols[stage]) {
        cols[stage].push(biz);
      } else {
        cols['new'].push(biz);
      }
    });

    return cols;
  }, [data]);

  // Handlers de Drag and Drop
  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    // Define uma imagem de arraste transparente se quiser customizar (opcional)
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setActiveCol(null);
  };

  const handleDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault(); // Necessário para permitir o drop
    e.dataTransfer.dropEffect = 'move';
    if (activeCol !== colId) {
      setActiveCol(colId);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Apenas reseta se realmente sair do container da coluna (logica complexa em React puro)
    // Simplificado: deixamos o dragOver gerenciar o activeCol, e o dragEnd limpar.
  };

  const handleDrop = (e: React.DragEvent, targetStage: string) => {
    e.preventDefault();
    const businessId = e.dataTransfer.getData('text/plain');
    if (businessId) {
      onStageChange(businessId, targetStage);
    }
    setActiveCol(null);
    setDraggedId(null);
  };

  return (
    <div className="flex flex-col md:flex-row gap-4 h-[calc(100vh-250px)] overflow-x-auto pb-4 custom-scrollbar">
      {COLUMNS.map(col => {
        const isActive = activeCol === col.id;
        const isEmpty = columnsData[col.id]?.length === 0;

        return (
          <div 
            key={col.id} 
            className={`flex-1 min-w-[300px] flex flex-col rounded-xl border transition-all duration-200 ${
              isActive 
                ? 'bg-slate-800/80 border-brand-500 shadow-[0_0_15px_rgba(14,165,233,0.15)] ring-1 ring-brand-500/50' 
                : 'bg-slate-900/50 border-slate-800'
            }`}
            onDragOver={(e) => handleDragOver(e, col.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col.id)}
          >
            {/* Column Header */}
            <div className={`p-4 border-b-2 ${col.color} flex justify-between items-center bg-slate-800/50 rounded-t-xl`}>
              <h3 className={`font-bold ${isActive ? 'text-white' : 'text-slate-200'} transition-colors`}>
                {col.title}
              </h3>
              <span className={`text-xs px-2 py-1 rounded-full font-mono font-bold ${
                isActive ? 'bg-brand-600 text-white' : 'bg-slate-700 text-slate-300'
              }`}>
                {columnsData[col.id]?.length || 0}
              </span>
            </div>

            {/* Column Body */}
            <div className={`flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar transition-colors ${
              isActive ? 'bg-brand-500/5' : ''
            }`}>
              {columnsData[col.id]?.map(biz => {
                const isDragging = draggedId === biz.id;
                
                return (
                  <div
                    key={biz.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, biz.id)}
                    onDragEnd={handleDragEnd}
                    className={`
                      relative p-4 rounded-lg border shadow-sm cursor-grab active:cursor-grabbing transition-all group
                      ${isDragging 
                        ? 'opacity-40 grayscale border-dashed border-slate-500 bg-slate-800/50 scale-95' 
                        : 'bg-slate-800 border-slate-700 hover:border-brand-500/50 hover:shadow-md hover:-translate-y-0.5'
                      }
                    `}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-bold text-slate-200 text-sm line-clamp-2 pr-4">{biz.name}</h4>
                      <GripVertical size={16} className={`shrink-0 ${isDragging ? 'text-slate-600' : 'text-slate-600 group-hover:text-brand-500'}`} />
                    </div>
                    
                    <p className="text-xs text-slate-500 mb-3 line-clamp-1">{biz.category}</p>

                    {/* Tags e Infos */}
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
                              onMouseDown={(e) => e.stopPropagation()} // Impede o drag ao clicar no link
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
                  </div>
                );
              })}
              
              {/* Empty State / Drop Placeholder */}
              {isEmpty && (
                <div className={`h-full flex flex-col items-center justify-center transition-opacity min-h-[120px] rounded-lg border-2 border-dashed ${
                   isActive ? 'border-brand-500/30 bg-brand-500/5 opacity-100' : 'border-slate-800 opacity-50'
                }`}>
                    <div className={`p-3 rounded-full mb-2 ${isActive ? 'bg-brand-500/20 text-brand-400' : 'bg-slate-800 text-slate-600'}`}>
                      {isActive ? <ArrowRight size={24} className="animate-pulse" /> : <AlertCircle size={24} />}
                    </div>
                    <span className={`text-xs ${isActive ? 'text-brand-300' : 'text-slate-500'}`}>
                       {isActive ? 'Solte aqui' : 'Arraste cards para cá'}
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
