import { BusinessEntity } from '../types';

export const exportService = {
    /**
     * Envia um lead para um Webhook configurado (Zapier, n8n, etc).
     * @param business O objeto do negócio a ser enviado.
     * @param webhookUrl A URL do Webhook.
     */
    async sendToWebhook(business: BusinessEntity, webhookUrl: string): Promise<boolean> {
        if (!webhookUrl) {
            throw new Error("URL do Webhook não configurada.");
        }

        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    lead_id: business.id,
                    company_name: business.name,
                    cnpj: business.cnpj || "Não informado",
                    category: business.category,
                    address: business.address,
                    phone: business.phone,
                    website: business.website,
                    social_links: business.socialLinks,
                    status: business.status,
                    trust_score: business.trustScore,
                    match_type: business.matchType,
                    generated_at: new Date().toISOString(),
                    source: "VeriCorp Intelligence"
                }),
            });

            if (!response.ok) {
                throw new Error(`Erro no Webhook: ${response.status} ${response.statusText}`);
            }

            return true;
        } catch (error) {
            console.error("Erro ao exportar para Webhook:", error);
            throw error;
        }
    }
};
