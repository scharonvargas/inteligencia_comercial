import { BusinessEntity } from "../types";

const DB_KEY = "vericorp_prospects_db";

/**
 * Serviço de Banco de Dados (Camada de Abstração)
 * 
 * Atualmente implementado usando localStorage para persistência imediata no cliente.
 * A estrutura async permite que este código seja substituído por chamadas de API 
 * (ex: Supabase, Firebase, Node backend) no futuro sem alterar a interface de uso.
 */

// Simula delay de rede para parecer uma API real
const simulateNetworkDelay = () => new Promise(resolve => setTimeout(resolve, 100));

export const dbService = {
  /**
   * Salva ou remove um prospect do banco de dados
   */
  toggleProspect: async (business: BusinessEntity): Promise<boolean> => {
    await simulateNetworkDelay();
    
    const storedData = localStorage.getItem(DB_KEY);
    const prospects: BusinessEntity[] = storedData ? JSON.parse(storedData) : [];
    
    // Usamos o nome e endereço como chave composta para evitar duplicatas já que IDs podem mudar em novas buscas
    const existingIndex = prospects.findIndex(
      p => p.name === business.name && p.address === business.address
    );

    let isAdded = false;

    if (existingIndex >= 0) {
      // Remover
      prospects.splice(existingIndex, 1);
      isAdded = false;
    } else {
      // Adicionar
      const newProspect = { ...business, isProspect: true };
      prospects.push(newProspect);
      isAdded = true;
    }

    localStorage.setItem(DB_KEY, JSON.stringify(prospects));
    return isAdded;
  },

  /**
   * Retorna todos os prospects salvos
   */
  getAllProspects: async (): Promise<BusinessEntity[]> => {
    await simulateNetworkDelay();
    const storedData = localStorage.getItem(DB_KEY);
    return storedData ? JSON.parse(storedData) : [];
  },

  /**
   * Verifica se uma empresa específica já está salva como prospect
   */
  checkIsProspect: (name: string, address: string): boolean => {
    // Síncrono para renderização rápida inicial, mas idealmente seria async em produção real
    const storedData = localStorage.getItem(DB_KEY);
    if (!storedData) return false;
    
    const prospects: BusinessEntity[] = JSON.parse(storedData);
    return prospects.some(p => p.name === name && p.address === address);
  }
};