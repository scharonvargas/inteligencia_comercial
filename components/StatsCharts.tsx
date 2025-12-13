import React from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie 
} from 'recharts';
import { BusinessEntity, BusinessStatus } from '../types';

interface StatsChartsProps {
  data: BusinessEntity[];
}

export const StatsCharts: React.FC<StatsChartsProps> = ({ data }) => {
  // Prepare data for Status Distribution (Pie)
  const statusCounts = data.reduce((acc, curr) => {
    acc[curr.status] = (acc[curr.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const pieData = Object.keys(statusCounts).map(status => ({
    name: status,
    value: statusCounts[status]
  }));

  const COLORS: Record<string, string> = {
    [BusinessStatus.VERIFIED]: '#10b981', // emerald-500
    [BusinessStatus.ACTIVE]: '#3b82f6', // blue-500
    [BusinessStatus.SUSPICIOUS]: '#f59e0b', // amber-500
    [BusinessStatus.CLOSED]: '#ef4444', // red-500
    [BusinessStatus.UNKNOWN]: '#64748b', // slate-500
  };

  // Prepare data for Trust Score (Bar)
  // Group by ranges: 0-20, 21-40, 41-60, 61-80, 81-100
  const trustRanges = [
    { name: '0-40', count: 0 },
    { name: '41-60', count: 0 },
    { name: '61-80', count: 0 },
    { name: '81-100', count: 0 },
  ];

  data.forEach(biz => {
    const score = biz.trustScore;
    if (score <= 40) trustRanges[0].count++;
    else if (score <= 60) trustRanges[1].count++;
    else if (score <= 80) trustRanges[2].count++;
    else trustRanges[3].count++;
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
      {/* Status Distribution */}
      <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-lg">
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Status de Verificação</h3>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[entry.name] || '#94a3b8'} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }}
                itemStyle={{ color: '#f8fafc' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-2 justify-center mt-2">
          {pieData.map(d => (
             <div key={d.name} className="flex items-center text-xs text-slate-400">
               <span className="w-3 h-3 rounded-full mr-1" style={{backgroundColor: COLORS[d.name]}}></span>
               {d.name} ({d.value})
             </div>
          ))}
        </div>
      </div>

      {/* Trust Score Distribution */}
      <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-lg">
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Análise de Confiabilidade</h3>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trustRanges}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip 
                cursor={{fill: '#334155', opacity: 0.4}}
                contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }}
              />
              <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-center text-slate-400 mt-2">Pontuações mais altas indicam presença online verificada e atividade recente.</p>
      </div>
    </div>
  );
};