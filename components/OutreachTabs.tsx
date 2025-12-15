import React, { useState } from 'react';
import { Mail, MessageCircle, Linkedin, Phone, Copy, Check, ExternalLink } from 'lucide-react';
import { OutreachScripts } from '../types';

interface OutreachTabsProps {
    scripts: OutreachScripts;
    businessName: string;
    phone: string | null;
}

type TabType = 'email' | 'whatsapp' | 'linkedin' | 'phone';

export const OutreachTabs: React.FC<OutreachTabsProps> = ({ scripts, businessName, phone }) => {
    const [activeTab, setActiveTab] = useState<TabType>('whatsapp'); // WhatsApp por padrão (mais ágil)
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const handleCopy = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const getWaLink = () => {
        if (!phone) return '#';
        const cleanPhone = phone.replace(/\D/g, '');
        const number = cleanPhone.length <= 11 ? `55${cleanPhone}` : cleanPhone;
        return `https://wa.me/${number}?text=${encodeURIComponent(scripts.whatsapp)}`;
    };

    const tabs = [
        { id: 'whatsapp', icon: <MessageCircle size={14} />, label: 'WhatsApp', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
        { id: 'linkedin', icon: <Linkedin size={14} />, label: 'LinkedIn', color: 'text-blue-400', bg: 'bg-blue-500/10' },
        { id: 'email', icon: <Mail size={14} />, label: 'Email', color: 'text-slate-300', bg: 'bg-slate-500/10' },
        { id: 'phone', icon: <Phone size={14} />, label: 'Telefone', color: 'text-amber-400', bg: 'bg-amber-500/10' },
    ];

    return (
        <div className="bg-slate-900 rounded-lg border border-slate-700 overflow-hidden flex flex-col h-full">
            {/* Tab Header */}
            <div className="flex border-b border-slate-700 overflow-x-auto custom-scrollbar">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as TabType)}
                        className={`flex items-center gap-2 px-4 py-3 text-xs font-bold transition-all whitespace-nowrap border-r border-slate-800 last:border-r-0 ${activeTab === tab.id
                                ? `${tab.bg} ${tab.color} border-b-2 border-b-current`
                                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                            }`}
                    >
                        {tab.icon}
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 p-0 flex flex-col min-h-[200px]">

                {/* Helper Action Bar */}
                <div className="bg-slate-900/50 p-2 border-b border-slate-800 flex justify-between items-center">
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider pl-2">
                        {activeTab === 'phone' ? 'Roteiro de Ligação' : 'Mensagem Gerada'}
                    </span>

                    <div className="flex gap-2">
                        {activeTab === 'whatsapp' && phone && (
                            <a
                                href={getWaLink()}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 text-[10px] bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded font-bold transition-colors"
                            >
                                <ExternalLink size={10} /> Abrir WhatsApp
                            </a>
                        )}

                        <button
                            onClick={() => handleCopy(scripts[activeTab as keyof OutreachScripts], activeTab)}
                            className="flex items-center gap-1 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-2 py-1 rounded font-bold transition-colors"
                        >
                            {copiedId === activeTab ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} />}
                            {copiedId === activeTab ? 'Copiado!' : 'Copiar Texto'}
                        </button>
                    </div>
                </div>

                {/* Text Display */}
                <div className="flex-1 p-4 bg-slate-950/30 overflow-y-auto custom-scrollbar">
                    <pre className="whitespace-pre-wrap font-sans text-xs text-slate-300 leading-relaxed">
                        {scripts[activeTab as keyof OutreachScripts]}
                    </pre>
                </div>
            </div>
        </div>
    );
};
