import React, { useState, useEffect } from 'react';
import { templateService, MessageTemplate } from '../services/dbService';
import { BusinessEntity } from '../types';
import {
    MessageSquare, Mail, Plus, Trash2, Copy, Check, X, Edit, Save,
    Send
} from 'lucide-react';

interface MessageTemplatesProps {
    isOpen: boolean;
    onClose: () => void;
    selectedBusiness?: BusinessEntity | null;
    onSendMessage?: (message: string, type: 'whatsapp' | 'email') => void;
}

const DEFAULT_TEMPLATES: Partial<MessageTemplate>[] = [
    {
        name: 'Primeiro Contato WhatsApp',
        content: 'Olá! Encontrei a {{empresa}} e gostaria de saber mais sobre seus serviços. Podemos conversar?',
        type: 'whatsapp'
    },
    {
        name: 'Proposta Comercial',
        content: 'Olá {{empresa}}!\n\nGostaria de apresentar uma proposta que pode agregar valor ao seu negócio na área de {{categoria}}.\n\nPodemos agendar uma conversa rápida?\n\nAguardo seu retorno!',
        type: 'whatsapp'
    },
    {
        name: 'Email de Apresentação',
        content: 'Prezados,\n\nEncontrei a {{empresa}} e acredito que nossos serviços podem ser de grande valor para vocês.\n\nGostaria de agendar uma breve reunião para apresentar nossas soluções.\n\nAtenciosamente',
        type: 'email'
    }
];

export const MessageTemplates: React.FC<MessageTemplatesProps> = ({
    isOpen,
    onClose,
    selectedBusiness,
    onSendMessage
}) => {
    const [templates, setTemplates] = useState<MessageTemplate[]>([]);
    const [selectedTemplate, setSelectedTemplate] = useState<MessageTemplate | null>(null);
    const [editMode, setEditMode] = useState(false);
    const [editContent, setEditContent] = useState('');
    const [editName, setEditName] = useState('');
    const [editType, setEditType] = useState<'whatsapp' | 'email'>('whatsapp');
    const [isCreating, setIsCreating] = useState(false);
    const [copied, setCopied] = useState(false);
    const [previewText, setPreviewText] = useState('');

    const loadTemplates = async () => {
        let tpls = await templateService.getTemplates();

        // Create default templates if none exist
        if (tpls.length === 0) {
            for (const def of DEFAULT_TEMPLATES) {
                await templateService.createTemplate(def.name!, def.content!, def.type!);
            }
            tpls = await templateService.getTemplates();
        }

        setTemplates(tpls);
    };

    useEffect(() => {
        if (isOpen) {
            loadTemplates();
        }
    }, [isOpen]);

    useEffect(() => {
        if (selectedTemplate && selectedBusiness) {
            const applied = templateService.applyVariables(selectedTemplate.content, {
                name: selectedBusiness.name,
                phone: selectedBusiness.phone ?? undefined,
                address: selectedBusiness.address,
                category: selectedBusiness.category
            });
            setPreviewText(applied);
        } else if (selectedTemplate) {
            setPreviewText(selectedTemplate.content);
        }
    }, [selectedTemplate, selectedBusiness]);

    const handleCreate = async () => {
        if (!editName.trim() || !editContent.trim()) return;
        await templateService.createTemplate(editName.trim(), editContent.trim(), editType);
        setIsCreating(false);
        setEditName('');
        setEditContent('');
        loadTemplates();
    };

    const handleUpdate = async () => {
        if (!selectedTemplate || !editContent.trim()) return;
        await templateService.updateTemplate(selectedTemplate.id, {
            name: editName.trim() || selectedTemplate.name,
            content: editContent.trim()
        });
        setEditMode(false);
        loadTemplates();
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Deletar este template?')) return;
        await templateService.deleteTemplate(id);
        if (selectedTemplate?.id === id) {
            setSelectedTemplate(null);
        }
        loadTemplates();
    };

    const handleCopy = async () => {
        await navigator.clipboard.writeText(previewText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleSend = () => {
        if (selectedTemplate && previewText) {
            onSendMessage?.(previewText, selectedTemplate.type);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn p-4">
            <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-4xl shadow-2xl max-h-[90vh] overflow-hidden flex">
                {/* Left Panel - Template List */}
                <div className="w-1/3 border-r border-slate-700 flex flex-col">
                    <div className="p-4 border-b border-slate-700 flex items-center justify-between">
                        <h3 className="font-semibold text-white flex items-center gap-2">
                            <MessageSquare size={18} className="text-brand-400" />
                            Templates
                        </h3>
                        <button
                            onClick={() => { setIsCreating(true); setEditMode(false); setSelectedTemplate(null); }}
                            className="p-1.5 bg-brand-600 hover:bg-brand-500 rounded-lg text-white"
                        >
                            <Plus size={16} />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {templates.map((tpl) => (
                            <button
                                key={tpl.id}
                                onClick={() => {
                                    setSelectedTemplate(tpl);
                                    setIsCreating(false);
                                    setEditMode(false);
                                    setEditContent(tpl.content);
                                    setEditName(tpl.name);
                                }}
                                className={`w-full text-left p-3 border-b border-slate-700/50 hover:bg-slate-700/50 transition-colors ${selectedTemplate?.id === tpl.id ? 'bg-brand-600/20 border-l-2 border-l-brand-500' : ''
                                    }`}
                            >
                                <div className="flex items-center gap-2">
                                    {tpl.type === 'whatsapp' ? (
                                        <MessageSquare size={14} className="text-emerald-400" />
                                    ) : (
                                        <Mail size={14} className="text-blue-400" />
                                    )}
                                    <span className="text-sm text-white truncate">{tpl.name}</span>
                                </div>
                                <p className="text-xs text-slate-500 truncate mt-1">{tpl.content.slice(0, 50)}...</p>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Right Panel - Editor/Preview */}
                <div className="flex-1 flex flex-col">
                    <div className="p-4 border-b border-slate-700 flex items-center justify-between">
                        <h3 className="font-semibold text-white">
                            {isCreating ? 'Novo Template' : editMode ? 'Editar' : 'Preview'}
                        </h3>
                        <button onClick={onClose} className="text-slate-400 hover:text-white">
                            <X size={20} />
                        </button>
                    </div>

                    {isCreating ? (
                        <div className="flex-1 p-4 space-y-4">
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Nome</label>
                                <input
                                    type="text"
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    placeholder="Nome do template..."
                                    className="w-full bg-slate-900/50 border border-slate-700 rounded-lg p-2 text-white text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Tipo</label>
                                <select
                                    value={editType}
                                    onChange={(e) => setEditType(e.target.value as 'whatsapp' | 'email')}
                                    className="w-full bg-slate-900/50 border border-slate-700 rounded-lg p-2 text-white text-sm"
                                >
                                    <option value="whatsapp">WhatsApp</option>
                                    <option value="email">Email</option>
                                </select>
                            </div>
                            <div className="flex-1">
                                <label className="block text-xs text-slate-400 mb-1">
                                    Conteúdo (use {'{{nome}}'}, {'{{empresa}}'}, {'{{categoria}}'})
                                </label>
                                <textarea
                                    value={editContent}
                                    onChange={(e) => setEditContent(e.target.value)}
                                    placeholder="Digite sua mensagem..."
                                    className="w-full h-40 bg-slate-900/50 border border-slate-700 rounded-lg p-3 text-white text-sm resize-none"
                                />
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setIsCreating(false)}
                                    className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleCreate}
                                    disabled={!editName.trim() || !editContent.trim()}
                                    className="flex-1 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-lg disabled:opacity-50"
                                >
                                    Criar
                                </button>
                            </div>
                        </div>
                    ) : selectedTemplate ? (
                        <div className="flex-1 p-4 flex flex-col">
                            {editMode ? (
                                <>
                                    <input
                                        type="text"
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        className="w-full bg-slate-900/50 border border-slate-700 rounded-lg p-2 text-white text-sm mb-3"
                                    />
                                    <textarea
                                        value={editContent}
                                        onChange={(e) => setEditContent(e.target.value)}
                                        className="flex-1 bg-slate-900/50 border border-slate-700 rounded-lg p-3 text-white text-sm resize-none"
                                    />
                                </>
                            ) : (
                                <>
                                    {selectedBusiness && (
                                        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2 mb-3 text-xs text-emerald-400">
                                            Aplicando para: <strong>{selectedBusiness.name}</strong>
                                        </div>
                                    )}
                                    <div className="flex-1 bg-slate-900/50 rounded-lg p-4 overflow-y-auto">
                                        <pre className="text-white text-sm whitespace-pre-wrap font-sans">{previewText}</pre>
                                    </div>
                                </>
                            )}

                            {/* Actions */}
                            <div className="flex gap-2 mt-4">
                                {editMode ? (
                                    <>
                                        <button
                                            onClick={() => setEditMode(false)}
                                            className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg flex items-center justify-center gap-2"
                                        >
                                            <X size={16} /> Cancelar
                                        </button>
                                        <button
                                            onClick={handleUpdate}
                                            className="flex-1 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-lg flex items-center justify-center gap-2"
                                        >
                                            <Save size={16} /> Salvar
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => handleDelete(selectedTemplate.id)}
                                            className="p-2 bg-slate-700 hover:bg-red-600 text-slate-400 hover:text-white rounded-lg transition-colors"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                        <button
                                            onClick={() => { setEditMode(true); setEditContent(selectedTemplate.content); setEditName(selectedTemplate.name); }}
                                            className="p-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg"
                                        >
                                            <Edit size={16} />
                                        </button>
                                        <button
                                            onClick={handleCopy}
                                            className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg flex items-center justify-center gap-2"
                                        >
                                            {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                                            {copied ? 'Copiado!' : 'Copiar'}
                                        </button>
                                        {selectedBusiness && (
                                            <button
                                                onClick={handleSend}
                                                className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg flex items-center justify-center gap-2"
                                            >
                                                <Send size={16} /> Enviar
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-slate-500">
                            <p>Selecione um template ou crie um novo</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
