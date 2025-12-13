import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { cnpj } = req.query;

    if (!cnpj || typeof cnpj !== 'string') {
        return res.status(400).json({ error: 'CNPJ é obrigatório.' });
    }

    // Remove caracteres não numéricos
    const cleanCnpj = cnpj.replace(/\D/g, '');

    if (cleanCnpj.length !== 14) {
        return res.status(400).json({ error: 'CNPJ inválido (deve ter 14 dígitos).' });
    }

    try {
        const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleanCnpj}`);

        if (!response.ok) {
            if (response.status === 404) {
                return res.status(404).json({ error: 'CNPJ não encontrado na Receita Federal.' });
            }
            throw new Error(`BrasilAPI Error: ${response.status}`);
        }

        const data = await response.json();

        // Retornar apenas dados relevantes para economizar banda e simplificar o frontend
        const simplifiedData = {
            cnpj: data.cnpj,
            razao_social: data.razao_social,
            nome_fantasia: data.nome_fantasia,
            situacao_cadastral: data.situacao_cadastral, // "ATIVA", "BAIXADA", etc.
            data_situacao_cadastral: data.data_situacao_cadastral,
            cnae_principal: data.cnae_fiscal_descricao,
            endereco: `${data.logradouro}, ${data.numero} ${data.complemento || ''} - ${data.bairro}, ${data.municipio} - ${data.uf}`,
            cep: data.cep
        };

        return res.status(200).json(simplifiedData);

    } catch (error: any) {
        console.error('Erro na consulta CNPJ:', error);
        return res.status(500).json({ error: 'Erro ao consultar serviço de CNPJ.' });
    }
}
