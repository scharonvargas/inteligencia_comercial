import React, { useState, useEffect } from 'react';
import { X, Save, Globe } from 'lucide-react';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const STORAGE_KEYS = {
    WEBHOOK_URL: 'vericorp_webhook_url'
};

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    const [webhookUrl, setWebhookUrl] = useState('');
    const [showToast, setShowToast] = useState(false);

    useEffect(() => {
        if (isOpen) {
            const savedUrl = localStorage.getItem(STORAGE_KEYS.WEBHOOK_URL) || '';
            setWebhookUrl(savedUrl);
        }
    }, [isOpen]);

    const handleSave = () => {
        localStorage.setItem(STORAGE_KEYS.WEBHOOK_URL, webhookUrl);
        setShowToast(true);
        setTimeout(() => {
            setShowToast(false);
            onClose();
        }, 1500);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-fadeIn">
            <div className="bg-slate-900 w-full max-w-md rounded-xl border border-slate-700 shadow-2xl relative overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900/50">
                    <h3 className="text-white font-bold flex items-center gap-2">
                        Configurações
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-white transition-colors p-1 hover:bg-slate-800 rounded-full"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6">
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                                <Globe size={16} className="text-brand-500" />
                                Webhook de Exportação
                            </label>
                            <p className="text-xs text-slate-500 mb-2">
                                URL para onde os dados serão enviados ao clicar em "Exportar Webhook".
                            </p>
                            <input
                                type="url"
                                value={webhookUrl}
                                onChange={(e) => setWebhookUrl(e.target.value)}
                                placeholder="https://webhook.site/..."
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-white placeholder-slate-500 focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none transition-all"
                            />
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-800 bg-slate-900/50 flex justify-end">
                    <button
                        onClick={handleSave}
                        className="flex items-center gap-2 bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-lg shadow-brand-500/10"
                    >
                        {showToast ? <span className="animate-pulse">Salvo!</span> : (
                            <>
                                <Save size={18} />
                                <span>Salvar Configurações</span>
                            </>
                        )}
                    </button>
                </div>

            </div>
        </div>
    );
};
