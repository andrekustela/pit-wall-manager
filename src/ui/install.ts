// "Instalar como app" (PWA): o Chrome/Edge avisa quando dá pra instalar; o
// menu mostra o botão. Instalado, o jogo abre na própria janela, com ícone na
// área de trabalho e no menu Iniciar.
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();

export function setupInstall() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* sem service worker: o jogo funciona igual */
    });
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    listeners.forEach((f) => f());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((f) => f());
  });
}

/** já está rodando como app instalado */
export function isInstalled(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: window-controls-overlay)").matches;
}

export function canInstall(): boolean {
  return !!deferred && !isInstalled();
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const d = deferred;
  deferred = null;
  await d.prompt();
  const { outcome } = await d.userChoice;
  listeners.forEach((f) => f());
  return outcome === "accepted";
}

/** avisa quando dá (ou deixa de dar) pra instalar */
export function onInstallChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** botão "instalar" num lugar da tela (aparece só quando o navegador deixa) */
export function mountInstallButton(slot: HTMLElement) {
  const render = () => {
    if (!slot.isConnected) {
      off();
      return;
    }
    slot.innerHTML = canInstall() ? `<button class="btn installbtn" title="Instala o jogo no computador: abre na própria janela, com ícone na área de trabalho">⬇ INSTALAR NO PC</button>` : "";
    slot.querySelector("button")?.addEventListener("click", () => void promptInstall());
  };
  const off = onInstallChange(render);
  render();
}
