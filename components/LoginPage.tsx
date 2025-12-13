import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Mail, Lock, Loader2, Sparkles, AlertCircle, CheckCircle } from 'lucide-react';

type AuthMode = 'login' | 'register' | 'magic-link';

export const LoginPage: React.FC = () => {
    const { signIn, signUp, signInWithMagicLink } = useAuth();
    const [mode, setMode] = useState<AuthMode>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSuccess(null);

        try {
            if (mode === 'magic-link') {
                const { error } = await signInWithMagicLink(email);
                if (error) throw error;
                setSuccess('Link de acesso enviado para seu e-mail!');
            } else if (mode === 'login') {
                const { error } = await signIn(email, password);
                if (error) throw error;
            } else {
                const { error } = await signUp(email, password);
                if (error) throw error;
                setSuccess('Conta criada! Verifique seu e-mail para confirmar.');
            }
        } catch (err: any) {
            setError(err.message || 'Erro ao autenticar');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-brand-950 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center gap-3 mb-4">
                        <div className="p-3 bg-brand-600/20 rounded-xl border border-brand-500/30">
                            <Sparkles className="text-brand-400" size={32} />
                        </div>
                        <h1 className="text-3xl font-bold text-white">VeriCorp</h1>
                    </div>
                    <p className="text-slate-400">Inteligência Comercial com IA</p>
                </div>

                {/* Card */}
                <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-8 shadow-2xl">
                    {/* Tabs */}
                    <div className="flex gap-2 mb-6">
                        <button
                            onClick={() => setMode('login')}
                            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${mode === 'login'
                                    ? 'bg-brand-600 text-white'
                                    : 'bg-slate-700/50 text-slate-400 hover:text-white'
                                }`}
                        >
                            Entrar
                        </button>
                        <button
                            onClick={() => setMode('register')}
                            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${mode === 'register'
                                    ? 'bg-brand-600 text-white'
                                    : 'bg-slate-700/50 text-slate-400 hover:text-white'
                                }`}
                        >
                            Criar Conta
                        </button>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* Email */}
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                E-mail
                            </label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="seu@email.com"
                                    required
                                    className="w-full bg-slate-900/50 border border-slate-700 rounded-lg py-3 px-10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                                />
                            </div>
                        </div>

                        {/* Password (not for magic link) */}
                        {mode !== 'magic-link' && (
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">
                                    Senha
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="••••••••"
                                        required
                                        minLength={6}
                                        className="w-full bg-slate-900/50 border border-slate-700 rounded-lg py-3 px-10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                                    />
                                </div>
                            </div>
                        )}

                        {/* Error */}
                        {error && (
                            <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                                <AlertCircle size={16} />
                                {error}
                            </div>
                        )}

                        {/* Success */}
                        {success && (
                            <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                                <CheckCircle size={16} />
                                {success}
                            </div>
                        )}

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="animate-spin" size={18} />
                                    Processando...
                                </>
                            ) : mode === 'login' ? (
                                'Entrar'
                            ) : mode === 'register' ? (
                                'Criar Conta'
                            ) : (
                                'Enviar Link'
                            )}
                        </button>
                    </form>

                    {/* Magic Link Option */}
                    <div className="mt-6 pt-6 border-t border-slate-700">
                        <button
                            onClick={() => setMode(mode === 'magic-link' ? 'login' : 'magic-link')}
                            className="w-full text-sm text-slate-400 hover:text-brand-400 transition-colors"
                        >
                            {mode === 'magic-link'
                                ? '← Voltar para login com senha'
                                : 'Entrar com link mágico (sem senha)'}
                        </button>
                    </div>
                </div>

                {/* Footer */}
                <p className="text-center text-slate-500 text-xs mt-6">
                    Ao continuar, você concorda com nossos Termos de Uso e Política de Privacidade.
                </p>
            </div>
        </div>
    );
};
