
import React, { useMemo } from 'react';
import { BusinessEntity } from '../types';
import { GripVertical, Phone, ExternalLink, MapPin, Calendar, AlertCircle } from 'lucide-react';

interface KanbanBoardProps {
  data: BusinessEntity[];
  onStageChange: (businessId: string, newStage: string) => void;
}

const COLUMNS = [
  { id: 'new', title: 'Novos', color: 'border-blue-500/50 bg-blue-500/5' },
  { id: 'qualified', title: 'Qualificados', color: 'border-emerald-500/50 bg-emerald-500/5' },
  { id: 'contacted', title: 'Em Contato', color: 'border-amber-500/50 bg-amber-500/5' },
  { id: 'discarded', title: 'Descartados', color: 'border-red-500/50 bg-red-500/5' },
];

export const KanbanBoard: React.FC<KanbanBoardProps> = ({ data, onStageChange }) => {
  
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
        // Fallback para 'new' se o estágio for desconhecido
        cols['new'].push(biz);
      }
    });

    return cols;
  }, [data]);

  // Handlers de Drag and Drop
  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    // Adiciona uma classe visual temporária
    (e.target as HTMLElement).classList.add('opacity-50');
  };

  const handleDragEnd = (e: React.DragEvent) => {
    (e.target as HTMLElement).classList.remove('opacity-50');
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // Necessário para permitir o drop
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetStage: string) => {
    e.preventDefault();
    const businessId = e.dataTransfer.getData('text/plain');
    if (businessId) {
      onStageChange(businessId, targetStage);
    }
  };

  return (
    <div className="flex flex-col md:flex-row gap-4 h-[calc(100vh-250px)] overflow-x-auto pb-4 custom-scrollbar">
      {COLUMNS.map(col => (
        <div 
          key={col.id} 
          className="flex-1 min-w-[300px] flex flex-col bg-slate-900/50 rounded-xl border border-slate-800"
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, col.id)}
        >
          {/* Column Header */}
          <div className={`p-4 border-b-2 ${col.color} flex justify-between items-center bg-slate-800/50 rounded-t-xl`}>
            <h3 className="font-bold text-slate-200">{col.title}</h3>
            <span className="bg-slate-700 text-slate-300 text-xs px-2 py-1 rounded-full font-mono">
              {columnsData[col.id]?.length || 0}
            </span>
          </div>

          {/* Column Body */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar transition-colors hover:bg-slate-800/30">
            {columnsData[col.id]?.map(biz => (
              <div
                key={biz.id}
                draggable
                onDragStart={(e) => handleDragStart(e, biz.id)}
                onDragEnd={handleDragEnd}
                className="bg-slate-800 p-4 rounded-lg border border-slate-700 shadow-sm cursor-grab active:cursor-grabbing hover:border-brand-500/50 transition-all hover:shadow-md group"
              >
                <div className="flex justify-between items-start mb-2">
                  <h4 className="font-bold text-slate-200 text-sm line-clamp-2">{biz.name}</h4>
                  <GripVertical size={16} className="text-slate-600 group-hover:text-brand-500" />
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
                          className="text-slate-400 hover:text-emerald-400 transition-colors"
                          title="WhatsApp"
                        >
                          <Phone size={14} />
                        </a>
                      )}
                      {biz.website && (
                        <a 
                          href={biz.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-400 hover:text-blue-400 transition-colors"
                          title="Website"
                        >
                          <ExternalLink size={14} />
                        </a>
                      )}
                      <div className="text-slate-400 hover:text-slate-200 cursor-help" title={biz.address}>
                        <MapPin size={14} />
                      </div>
                   </div>
                   <div className="text-[10px] text-slate-500 font-mono">
                      Score: {biz.trustScore}
                   </div>
                </div>
              </div>
            ))}
            
            {columnsData[col.id]?.length === 0 && (
               <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-50 min-h-[100px]">
                  <AlertCircle size={24} className="mb-2" />
                  <span className="text-xs">Arraste cards para cá</span>
               </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
