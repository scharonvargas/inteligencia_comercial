import React, { useState, useEffect } from 'react';
import { X, ChevronRight, Check, Search, Database, MessageSquare, BarChart3 } from 'lucide-react';

interface OnboardingModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const STEPS = [
    {
        title: 'Bem-vindo ao VeriCorp',
        description: 'Sua plataforma de inteligência comercial com IA. Encontre leads qualificados e enriquecidos em segundos.',
        icon: <Database className="text-brand-400" size={48} />,
        color: 'bg-brand-500/10 border-brand-500/20'
    },
    {
        title: 'Busca Inteligente',
        description: 'Use a barra de pesquisa para encontrar empresas por segmento e região. Nossa IA analisa e valida os dados para você.',
        icon: <Search className="text-blue-400" size={48} />,
        color: 'bg-blue-500/10 border-blue-500/20'
    },
    {
        title: 'Gestão Completa',
        description: 'Organize leads em listas, use templates de mensagem e acompanhe seu progresso no Dashboard.',
        icon: <BarChart3 className="text-emerald-400" size={48} />,
        color: 'bg-emerald-500/10 border-emerald-500/20'
    }
];

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose }) => {
    const [currentStep, setCurrentStep] = useState(0);

    if (!isOpen) return null;

    const handleNext = () => {
        if (currentStep < STEPS.length - 1) {
            setCurrentStep(prev => prev + 1);
        } else {
            onClose();
        }
    };

    const step = STEPS[currentStep];

    return (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in duration-300">

                {/* Progress Bar */}
                <div className="h-1 bg-slate-800 flex">
                    {STEPS.map((_, idx) => (
                        <div
                            key={idx}
                            className={`h-full transition-all duration-300 ${idx <= currentStep ? 'bg-brand-500' : 'bg-transparent'}`}
                            style={{ width: `${100 / STEPS.length}%` }}
                        />
                    ))}
                </div>

                <div className="p-8 pb-6 flex flex-col items-center text-center">
                    <div className={`p-6 rounded-full border mb-6 ${step.color} transition-all duration-500 transform`}>
                        {step.icon}
                    </div>

                    <h2 className="text-2xl font-bold text-white mb-3">{step.title}</h2>
                    <p className="text-slate-400 mb-8 leading-relaxed">
                        {step.description}
                    </p>

                    <div className="flex gap-3 w-full">
                        <button
                            onClick={onClose}
                            className="px-4 py-3 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors font-medium text-sm"
                        >
                            Pular
                        </button>
                        <button
                            onClick={handleNext}
                            className="flex-1 bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 group"
                        >
                            {currentStep === STEPS.length - 1 ? 'Começar' : 'Próximo'}
                            {currentStep === STEPS.length - 1 ? (
                                <Check size={18} />
                            ) : (
                                <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
                            )}
                        </button>
                    </div>
                </div>

                {/* Dots */}
                <div className="flex justify-center gap-2 pb-6">
                    {STEPS.map((_, idx) => (
                        <div
                            key={idx}
                            className={`w-2 h-2 rounded-full transition-colors duration-300 ${idx === currentStep ? 'bg-brand-500' : 'bg-slate-800'}`}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
};
