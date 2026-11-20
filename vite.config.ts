import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Configuración de Vite y Vitest para Ojo de Buey (OxEye).
 */
export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/OxEye/' : '/',
  plugins: [react()],
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    port: 5173,
    open: false,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
  },
});
