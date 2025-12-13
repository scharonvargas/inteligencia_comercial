import React, { useState, useEffect } from 'react';
import { leadListService, LeadList } from '../services/dbService';
import { FolderPlus, Trash2, Tag, X, Check, Palette } from 'lucide-react';

const PRESET_COLORS = [
    '#6366f1', // indigo
    '#10b981', // emerald
    '#f59e0b', // amber
    '#ef4444', // red
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#84cc16', // lime
];

interface LeadListsManagerProps {
    isOpen: boolean;
    onClose: () => void;
    onListsChange?: () => void;
}

export const LeadListsManager: React.FC<LeadListsManagerProps> = ({ isOpen, onClose, onListsChange }) => {
    const [lists, setLists] = useState<LeadList[]>([]);
    const [newListName, setNewListName] = useState('');
    const [newListColor, setNewListColor] = useState(PRESET_COLORS[0]);
    const [isCreating, setIsCreating] = useState(false);

    const loadLists = async () => {
        const data = await leadListService.getLists();
        setLists(data);
    };

    useEffect(() => {
        if (isOpen) {
            loadLists();
        }
    }, [isOpen]);

    const handleCreate = async () => {
        if (!newListName.trim()) return;
        await leadListService.createList(newListName.trim(), newListColor);
        setNewListName('');
        setNewListColor(PRESET_COLORS[0]);
        setIsCreating(false);
        loadLists();
        onListsChange?.();
    };

    const handleDelete = async (listId: string) => {
        if (!confirm('Remover esta lista? Os leads não serão deletados.')) return;
        await leadListService.deleteList(listId);
        loadLists();
        onListsChange?.();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
            <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-md shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-700">
                    <div className="flex items-center gap-2 text-white">
                        <Tag size={20} className="text-brand-400" />
                        <h3 className="font-semibold">Gerenciar Listas</h3>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 max-h-96 overflow-y-auto">
                    {/* Create New */}
                    {isCreating ? (
                        <div className="bg-slate-900/50 rounded-lg p-3 mb-4 border border-slate-700">
                            <input
                                type="text"
                                value={newListName}
                                onChange={(e) => setNewListName(e.target.value)}
                                placeholder="Nome da lista..."
                                className="w-full bg-transparent border-none text-white placeholder-slate-500 text-sm focus:outline-none mb-3"
                                autoFocus
                            />
                            <div className="flex items-center justify-between">
                                <div className="flex gap-1">
                                    {PRESET_COLORS.map((color) => (
                                        <button
                                            key={color}
                                            onClick={() => setNewListColor(color)}
                                            className={`w-6 h-6 rounded-full border-2 transition-all ${newListColor === color ? 'border-white scale-110' : 'border-transparent'}`}
                                            style={{ backgroundColor: color }}
                                        />
                                    ))}
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setIsCreating(false)}
                                        className="text-slate-400 hover:text-white text-sm"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={handleCreate}
                                        disabled={!newListName.trim()}
                                        className="bg-brand-600 hover:bg-brand-500 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
                                    >
                                        <Check size={14} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={() => setIsCreating(true)}
                            className="w-full flex items-center gap-2 p-3 rounded-lg border border-dashed border-slate-600 text-slate-400 hover:text-white hover:border-brand-500 transition-colors mb-4"
                        >
                            <FolderPlus size={18} />
                            Nova Lista
                        </button>
                    )}

                    {/* Lists */}
                    {lists.length === 0 ? (
                        <p className="text-center text-slate-500 text-sm py-4">
                            Nenhuma lista criada ainda
                        </p>
                    ) : (
                        <ul className="space-y-2">
                            {lists.map((list) => (
                                <li
                                    key={list.id}
                                    className="flex items-center justify-between p-3 bg-slate-900/30 rounded-lg border border-slate-700/50"
                                >
                                    <div className="flex items-center gap-2">
                                        <div
                                            className="w-3 h-3 rounded-full"
                                            style={{ backgroundColor: list.color }}
                                        />
                                        <span className="text-white text-sm">{list.name}</span>
                                    </div>
                                    <button
                                        onClick={() => handleDelete(list.id)}
                                        className="text-slate-500 hover:text-red-400 transition-colors"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-700">
                    <button
                        onClick={onClose}
                        className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                    >
                        Fechar
                    </button>
                </div>
            </div>
        </div>
    );
};
