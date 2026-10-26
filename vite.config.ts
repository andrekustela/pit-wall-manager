import { defineConfig } from "vite";

// em dev, /ws vai pro servidor online (npm run server)
export default defineConfig({
  // versão do jogo (no Render é o commit publicado; o servidor usa a mesma, pra
  // ninguém entrar numa sala com o jogo desatualizado)
  define: { __BUILD__: JSON.stringify(process.env.RENDER_GIT_COMMIT ?? "dev") },
  // workers com import dinâmico (IA e voz do rádio) precisam do formato de módulo
  worker: { format: "es" },
  server: {
    port: 5179,
    proxy: { "/ws": { target: "ws://localhost:8787", ws: true } },
  },
});
