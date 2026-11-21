import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  const cliProcessEnv = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env;
  return {
    base: cliProcessEnv?.VITE_BASE_PATH || env.VITE_BASE_PATH || '/',
    plugins: [react()],
    server: {
      port: 3001,
      host: true,
    },
    preview: {
      port: 3001,
      host: true,
    },
  };
});
