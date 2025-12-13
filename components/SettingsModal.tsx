import React, { useState, useEffect } from 'react';
import { X, Save, Zap, HelpCircle } from 'lucide-react';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentWebhookUrl: string;
    onSave: (url: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, currentWebhookUrl, onSave }) => {
    const [url, setUrl] = useState(currentWebhookUrl);

    useEffect(() => {
        setUrl(currentWebhookUrl);
    }, [currentWebhookUrl, isOpen]);

    if (!isOpen) return null;

    const handleSave = () => {
        onSave(url);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-fadeIn" onClick={onClose}>
            <div className="bg-slate-900 w-full max-w-md rounded-xl border border-slate-700 shadow-2xl relative overflow-hidden" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="flex items-center justify-between p-4 bg-slate-800/50 border-b border-slate-700">
                    <div className="flex items-center gap-2">
                        <Zap className="text-brand-500" size={20} />
                        <h3 className="text-slate-100 font-bold">Integrações & Configurações</h3>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 hover:bg-slate-700 rounded-full">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
                            Webhook URL (POST)
                            <div className="group relative cursor-help">
                                <HelpCircle size={14} className="text-slate-500" />
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 hidden group-hover:block z-50 shadow-xl">
                                    Receberá um JSON via POST com os dados do lead quando você clicar em Exportar. Compatível com Zapier, n8n, Make, etc.
                                </div>
                            </div>
                        </label>
                        <input
                            type="url"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder="https://hooks.zapier.com/hooks/catch/..."
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-sm text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none transition-all placeholder-slate-600"
                        />
                        <p className="text-xs text-slate-500">
                            Configure um Webhook para receber os dados dos leads automaticamente no seu CRM ou planilha.
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 bg-slate-800/50 border-t border-slate-700 flex justify-end">
                    <button
                        onClick={handleSave}
                        className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-lg font-bold text-sm transition-colors shadow-lg shadow-brand-500/20"
                    >
                        <Save size={16} />
                        Salvar Configurações
                    </button>
                </div>

            </div>
        </div>
    );
};
