import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Carrega variáveis de ambiente (prefixo '' carrega todas)
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    build: {
      chunkSizeWarningLimit: 2000 // Suppress warning for large chunks (in kB)
    },
    define: {
      // Mapeamento explícito de variáveis do Vercel (sem prefixo VITE_) para o código que espera VITE_
      'import.meta.env.VITE_API_KEY': JSON.stringify(env.API_KEY || process.env.API_KEY),
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.SUPABASE_URL || process.env.SUPABASE_URL || env.REACT_APP_SUPABASE_URL),
      'import.meta.env.VITE_SUPABASE_KEY': JSON.stringify(env.SUPABASE_KEY || process.env.SUPABASE_KEY || env.REACT_APP_SUPABASE_ANON_KEY),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || env.REACT_APP_SUPABASE_ANON_KEY),
      
      // Fallback para process.env para libs legadas, mas com segurança
      'process.env': {
        NODE_ENV: JSON.stringify(mode),
        // Adicione outras se necessário, mas evite expor tudo cegamente
      }
    }
  };
});