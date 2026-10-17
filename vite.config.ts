import { defineConfig } from "vite";

// em dev, /ws vai pro servidor online (npm run server)
export default defineConfig({
  server: {
    port: 5179,
    proxy: { "/ws": { target: "ws://localhost:8787", ws: true } },
  },
});
