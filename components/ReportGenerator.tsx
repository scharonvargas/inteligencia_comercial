import React, { useState } from 'react';
import { BusinessEntity } from '../types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface ReportGeneratorProps {
    data: BusinessEntity[];
    prospects: BusinessEntity[];
}

export const ReportGenerator: React.FC<ReportGeneratorProps> = ({ data, prospects }) => {
    const [isGenerating, setIsGenerating] = useState(false);

    const generatePDF = () => {
        setIsGenerating(true);

        try {
            const doc = new jsPDF();
            const today = new Date().toLocaleDateString('pt-BR');

            // Header
            doc.setFontSize(20);
            doc.setTextColor(40, 40, 40);
            doc.text('VeriCorp - Relatório Executivo', 14, 22);

            doc.setFontSize(10);
            doc.setTextColor(100, 100, 100);
            doc.text(`Gerado em: ${today}`, 14, 30);

            // KPIs Section
            doc.setFontSize(14);
            doc.setTextColor(40, 40, 40);
            doc.text('📊 Métricas Gerais', 14, 45);

            const totalLeads = data.length;
            const totalProspects = prospects.length;
            const avgScore = data.length > 0
                ? Math.round(data.reduce((sum, d) => sum + (d.viabilityScore || 50), 0) / data.length)
                : 0;
            const hotLeads = data.filter(d => (d.viabilityScore || 0) >= 70).length;

            doc.setFontSize(11);
            doc.text(`• Total de Leads Encontrados: ${totalLeads}`, 20, 55);
            doc.text(`• Leads Salvos (Prospects): ${totalProspects}`, 20, 62);
            doc.text(`• Score Médio de Viabilidade: ${avgScore}%`, 20, 69);
            doc.text(`• Leads "Quentes" (Score ≥ 70): ${hotLeads}`, 20, 76);

            // Top Leads Table
            doc.setFontSize(14);
            doc.text('🔥 Top 10 Leads (por Score)', 14, 92);

            const topLeads = [...data]
                .sort((a, b) => (b.viabilityScore || 0) - (a.viabilityScore || 0))
                .slice(0, 10);

            autoTable(doc, {
                startY: 98,
                head: [['Nome', 'Categoria', 'Telefone', 'Score']],
                body: topLeads.map(lead => [
                    lead.name.substring(0, 30),
                    lead.category || '-',
                    lead.phone || 'N/A',
                    `${lead.viabilityScore || 50}%`
                ]),
                styles: { fontSize: 9 },
                headStyles: { fillColor: [59, 130, 246] },
            });

            // Pipeline Summary (if prospects exist)
            if (prospects.length > 0) {
                const stages = ['new', 'contacted', 'negotiating', 'won', 'lost'];
                const stageNames: Record<string, string> = {
                    new: 'Novo', contacted: 'Contatado', negotiating: 'Negociando', won: 'Fechado', lost: 'Perdido'
                };
                const stageCounts = stages.map(s => ({
                    stage: stageNames[s] || s,
                    count: prospects.filter(p => p.pipelineStage === s).length
                }));

                const yPos = (doc as any).lastAutoTable.finalY + 15;
                doc.setFontSize(14);
                doc.text('📈 Distribuição do Pipeline', 14, yPos);

                autoTable(doc, {
                    startY: yPos + 6,
                    head: [['Etapa', 'Quantidade']],
                    body: stageCounts.map(s => [s.stage, s.count.toString()]),
                    styles: { fontSize: 9 },
                    headStyles: { fillColor: [34, 197, 94] },
                });
            }

            // Footer
            const pageCount = doc.internal.pages.length - 1;
            doc.setFontSize(8);
            doc.setTextColor(150);
            doc.text(`Página 1 de ${pageCount}`, 14, 285);
            doc.text('VeriCorp - Sistema de Inteligência Comercial', 105, 285, { align: 'center' });

            // Save
            doc.save(`vericorp_report_${today.replace(/\//g, '-')}.pdf`);

        } catch (err) {
            console.error('Erro ao gerar PDF:', err);
            alert('Erro ao gerar PDF. Verifique o console.');
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <button
            onClick={generatePDF}
            disabled={isGenerating}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 16px',
                backgroundColor: isGenerating ? '#6b7280' : '#ef4444',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: isGenerating ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: 500,
                transition: 'all 0.2s'
            }}
        >
            {isGenerating ? '⏳ Gerando...' : '📄 Gerar Relatório PDF'}
        </button>
    );
};

export default ReportGenerator;
