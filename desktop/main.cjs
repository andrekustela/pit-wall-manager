// Versão de PC (programa .exe) do Pit Wall Manager.
// Abre o jogo publicado numa janela própria: online, contas e atualizações
// funcionam como no navegador. Sem internet, abre a cópia que vem junto
// (dist/ dentro do programa) pra jogar solo.
const { app, BrowserWindow, protocol, net, shell, session } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// PWM_URL troca o endereço (só pra teste)
const ONLINE_URL = process.env.PWM_URL || "https://pit-wall-manager.onrender.com/";
const LOCAL_URL = "app://jogo/index.html";
// pasta do jogo: dentro do programa empacotado ou o dist/ do projeto (em teste)
const DIST = app.isPackaged ? path.join(process.resourcesPath, "dist") : path.join(__dirname, "..", "dist");

// (sem opções de GPU/FPS: "disable-frame-rate-limit" fazia o jogo rodar milhares de quadros por
// segundo e a janela travava em ~5 FPS; o padrão já acompanha o monitor, 144 Hz incluso)

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// só uma janela do jogo aberta por vez
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#0b0e14",
    title: "Pit Wall Manager",
    icon: path.join(__dirname, "icon.png"),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.cjs") },
  });
  win.removeMenu();
  win.once("ready-to-show", () => {
    win.maximize();
    win.show();
  });

  // F11 = tela cheia; F5 = recarregar; Ctrl+Shift+I = ferramentas (pra investigar problema)
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    } else if (input.key === "F5") {
      win.webContents.reload();
      e.preventDefault();
    } else if (input.key === "I" && input.control && input.shift) {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });

  // login com Google abre a janelinha do Google por cima; links de fora abrem no navegador
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(accounts\.google\.com|[^/]*\.firebaseapp\.com)\//.test(url)) {
      return { action: "allow", overrideBrowserWindowOptions: { width: 520, height: 680, autoHideMenuBar: true, parent: win } };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  // sem internet (ou servidor fora): cai pra cópia local
  let fellBack = false;
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMain) => {
    if (!isMain || fellBack || code === -3 /* cancelado */ || !url.startsWith(ONLINE_URL)) return;
    fellBack = true;
    win.loadURL(LOCAL_URL);
  });

  win.loadURL(ONLINE_URL);
}

app.whenReady().then(() => {
  // Google recusa login em "navegador embutido": se apresenta como Chrome normal
  const ua = session.defaultSession.getUserAgent().replace(/\s*(Electron|PitWallManager|pit-wall-manager)\/\S+/gi, "");
  session.defaultSession.setUserAgent(ua);

  // app://jogo/... = arquivos do jogo que vêm dentro do programa
  protocol.handle("app", (req) => {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p === "/" || p === "") p = "/index.html";
    const file = path.normalize(path.join(DIST, p));
    if (!file.startsWith(DIST)) return new Response("não encontrado", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  createWindow();
});

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on("window-all-closed", () => app.quit());
