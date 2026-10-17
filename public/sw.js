// Service worker do app instalado: guarda os arquivos do jogo pra abrir rápido
// (e abrir mesmo sem internet no modo solo). Sempre tenta a rede primeiro, então
// atualização nova chega na hora; o cache só vale quando a rede falha.
const CACHE = "pwm-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // só arquivos do próprio jogo (nada de WebSocket, login ou banco)
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/ws") || url.pathname === "/health") return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("/"))),
  );
});
