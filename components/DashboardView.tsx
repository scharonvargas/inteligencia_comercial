import React, { useMemo } from 'react';
import { ReportGenerator } from './ReportGenerator';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    PieChart, Pie, Cell, Sector
} from 'recharts';
import { Users, TrendingUp, Target, Award, DollarSign } from 'lucide-react';
import { BusinessEntity } from '../types';

interface DashboardViewProps {
    data: BusinessEntity[];
    prospects: BusinessEntity[];
}

export const DashboardView: React.FC<DashboardViewProps> = ({ data, prospects }) => {
    const kpis = useMemo(() => {
        const total = prospects.length;
        const qualified = prospects.filter(p => (p.viabilityScore || 0) >= 70).length;
        const active = prospects.filter(p => p.pipelineStage !== 'new' && p.pipelineStage !== 'lost').length;
        const conversionRate = total > 0 ? ((active / total) * 100).toFixed(1) : '0.0';

        // Simulação de valor potencial (R$ 5k por lead qualificado)
        const potentialRevenue = qualified * 1500;

        return { total, qualified, active, conversionRate, potentialRevenue };
    }, [prospects]);

    const pipelineData = useMemo(() => {
        const stages = { 'new': 0, 'contacted': 0, 'meeting': 0, 'closed': 0, 'lost': 0 };
        prospects.forEach(p => {
            const stage = p.pipelineStage || 'new';
            if (stages[stage] !== undefined) stages[stage]++;
        });

        return [
            { name: 'Novos', value: stages['new'], fill: '#94a3b8' },
            { name: 'Contatados', value: stages['contacted'], fill: '#3b82f6' },
            { name: 'Reunião', value: stages['meeting'], fill: '#8b5cf6' },
            { name: 'Fechados', value: stages['closed'], fill: '#10b981' },
            { name: 'Perdidos', value: stages['lost'], fill: '#ef4444' },
        ];
    }, [prospects]);

    const viabilityData = useMemo(() => {
        let high = 0, med = 0, low = 0;
        prospects.forEach(p => {
            const score = p.viabilityScore || 0;
            if (score >= 70) high++;
            else if (score >= 40) med++;
            else low++;
        });
        return [
            { name: '🔥 Quentes (70+)', value: high, color: '#10b981' },
            { name: '😐 Mornos (40-69)', value: med, color: '#f59e0b' },
            { name: '❄️ Frios (0-39)', value: low, color: '#94a3b8' },
        ].filter(d => d.value > 0);
    }, [prospects]);

    return (
        <div className="h-full overflow-y-auto bg-slate-50 p-6 space-y-8">

            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Dashboard de Inteligência</h2>
                    <p className="text-slate-500">Visão estratégica do seu pipeline de vendas</p>
                </div>
                <ReportGenerator data={data} prospects={prospects} />
            </div>

            {/* KPIs Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard
                    icon={<Users className="w-6 h-6 text-blue-600" />}
                    label="Total de Leads"
                    value={kpis.total}
                    trend="+12% essa semana"
                />
                <KPICard
                    icon={<Target className="w-6 h-6 text-emerald-600" />}
                    label="Leads Qualificados"
                    value={kpis.qualified}
                    subValue={`${((kpis.qualified / kpis.total) * 100 || 0).toFixed(0)}% do total`}
                />
                <KPICard
                    icon={<TrendingUp className="w-6 h-6 text-violet-600" />}
                    label="Em Negociação"
                    value={kpis.active}
                    trend="Ativos no funil"
                />
                <KPICard
                    icon={<DollarSign className="w-6 h-6 text-amber-600" />}
                    label="Pipeline Potencial"
                    value={`R$ ${kpis.potentialRevenue.toLocaleString('pt-BR')}`}
                    subValue="Estimat. Ticket Médio"
                />
            </div>

            {/* Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                {/* Pipeline Funnel */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
                    <h3 className="text-lg font-semibold text-slate-800 mb-6">Funil de Vendas</h3>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={pipelineData} layout="vertical" margin={{ left: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 12 }} />
                                <Tooltip
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    cursor={{ fill: 'transparent' }}
                                />
                                <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={32}>
                                    {pipelineData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.fill} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Viability Distribution */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
                    <h3 className="text-lg font-semibold text-slate-800 mb-6">Qualidade dos Leads (AI Score)</h3>
                    <div className="h-64 flex items-center justify-center">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={viabilityData}
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {viabilityData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend verticalAlign="bottom" height={36} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

            </div>
        </div>
    );
};

const KPICard = ({ icon, label, value, subValue, trend }: any) => (
    <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 flex items-start space-x-4">
        <div className="p-3 bg-slate-50 rounded-lg">
            {icon}
        </div>
        <div>
            <p className="text-sm font-medium text-slate-500">{label}</p>
            <h4 className="text-2xl font-bold text-slate-900 mt-1">{value}</h4>
            {(subValue || trend) && (
                <p className="text-xs text-slate-400 mt-1">
                    {trend ? <span className="text-emerald-600 font-medium">{trend}</span> : subValue}
                </p>
            )}
        </div>
    </div>
);
