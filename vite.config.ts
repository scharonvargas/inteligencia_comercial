import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react()],
    build: {
      chunkSizeWarningLimit: 2000 // Suppress warning for large chunks (in kB)
    },
    define: {
      // Garante retrocompatibilidade com código que usa process.env
      'process.env': env
    }
  };
});