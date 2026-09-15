import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Nombres neutros para los chunks de code-splitting (ver App.jsx,
        // páginas cargadas con lazy()). Por default Rollup nombra cada
        // chunk según el archivo de origen (ej. "PrivacyPolicy-xxxx.js"),
        // y bloqueadores de anuncios/privacidad (Brave Shields, listas
        // tipo EasyPrivacy) bloquean por heurística cualquier URL que
        // contenga palabras como "privacy", "ads", "track", etc. — nos
        // pasó en dev con PrivacyPolicy.jsx. Con nombres genéricos tipo
        // hash, ningún chunk revela de qué página se trata.
        chunkFileNames: 'assets/chunk-[hash].js',
      },
    },
  },
});
