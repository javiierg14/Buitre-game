import { defineConfig } from 'vite';

// El servidor se fija a 127.0.0.1 porque el harness de captura (Playwright)
// entra por IPv4; el `localhost` por defecto resuelve a ::1 en macOS y la
// captura no lo alcanza.
// `hmr: false` cuando el harness es dueño del servidor (BUITRE_NO_HMR=1): un
// archivo guardado mientras se captura recarga la página a mitad de frame y
// Playwright falla con "Execution context was destroyed".
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr: process.env.BUITRE_NO_HMR ? false : undefined,
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { target: 'es2022', sourcemap: true },
});
