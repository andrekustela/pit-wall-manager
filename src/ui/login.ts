// Tela de entrada: login por e-mail e senha (Supabase), criar conta, esqueci a
// senha ou jogar sem conta. Ao fundo, carros passando numa reta.
import { account, accountsEnabled } from "../net/account";
import { TEAMS } from "../sim/data";
import { carImage } from "../render/carArt";
import { esc } from "./common";

export function showLogin(root: HTMLElement, onDone: (guest: boolean) => void) {
  let mode: "in" | "up" | "reset" = "in";
  let raf = 0;
  root.innerHTML = `
    <div class="loginscreen">
      <canvas class="loginbg"></canvas>
      <div class="loginbox panel">
        <h1 class="title" style="text-align:center;margin:0">PIT WALL <span>MANAGER</span></h1>
        <p class="sub" style="text-align:center;margin:6px 0 18px">Você é o engenheiro-chefe.</p>
        <div class="seg logintabs"><button data-mode="in" class="on">ENTRAR</button><button data-mode="up">CRIAR CONTA</button></div>
        <form class="loginform">
          <label class="fld" data-only="up"><span>Nome do engenheiro</span><input class="txt" id="lg-name" maxlength="18" placeholder="Ex.: André" autocomplete="nickname"></label>
          <label class="fld" data-only="up"><span>Nome da equipe (opcional)</span><input class="txt" id="lg-team" maxlength="24" placeholder="Ex.: Kustela Racing"></label>
          <label class="fld"><span>E-mail</span><input class="txt" id="lg-email" type="email" autocomplete="email" required></label>
          <label class="fld" data-hide="reset"><span>Senha</span><input class="txt" id="lg-pass" type="password" minlength="6" autocomplete="current-password"></label>
          <div class="loginmsg" id="lg-msg"></div>
          <button class="go" id="lg-go" style="width:100%;margin:6px 0 0">ENTRAR ▶</button>
        </form>
        <div class="loginlinks">
          <button class="linkbtn" id="lg-forgot">esqueci a senha</button>
          <button class="linkbtn" id="lg-guest">jogar sem conta</button>
        </div>
        <p class="hint" style="text-align:center;margin:14px 0 0">Com conta, seu perfil, suas estatísticas e o campeonato ficam salvos e você entra de qualquer computador. Nome e equipe dá pra trocar depois em "editar perfil".</p>
      </div>
    </div>`;

  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const msg = (t: string, ok = false) => {
    const m = $("#lg-msg");
    m.textContent = t;
    m.classList.toggle("ok", ok);
  };
  const setMode = (m: typeof mode) => {
    mode = m;
    root.querySelectorAll<HTMLElement>("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
    root.querySelectorAll<HTMLElement>("[data-only=up]").forEach((el) => (el.hidden = m !== "up"));
    root.querySelectorAll<HTMLElement>("[data-hide=reset]").forEach((el) => (el.hidden = m === "reset"));
    $("#lg-go").textContent = m === "in" ? "ENTRAR ▶" : m === "up" ? "CRIAR CONTA ▶" : "MANDAR LINK PRO E-MAIL";
    $<HTMLInputElement>("#lg-pass").autocomplete = m === "up" ? "new-password" : "current-password";
    msg("");
  };
  root.querySelectorAll<HTMLElement>("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode as typeof mode)));
  $("#lg-forgot").addEventListener("click", () => setMode("reset"));
  const finish = (guest: boolean) => {
    cancelAnimationFrame(raf);
    onDone(guest);
  };
  $("#lg-guest").addEventListener("click", () => finish(true));

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $<HTMLInputElement>("#lg-email").value.trim();
    const pass = $<HTMLInputElement>("#lg-pass").value;
    const name = $<HTMLInputElement>("#lg-name").value.trim();
    const team = $<HTMLInputElement>("#lg-team").value.trim();
    const go = $<HTMLButtonElement>("#lg-go");
    if (!accountsEnabled()) return msg("As contas ainda não estão ligadas neste servidor. Use \"jogar sem conta\" por enquanto.");
    if (!email) return msg("Coloque seu e-mail.");
    if (mode !== "reset" && pass.length < 6) return msg("A senha precisa ter pelo menos 6 caracteres.");
    if (mode === "up" && !name) return msg("Coloque o nome do engenheiro.");
    go.disabled = true;
    msg("Um segundo...", true);
    try {
      if (mode === "reset") {
        const err = await account.resetPassword(email);
        msg(err ?? "Pronto! Veja seu e-mail pra criar uma senha nova.", !err);
      } else if (mode === "up") {
        const err = await account.signUp(email, pass, name, team);
        if (err === "confirm") msg("Conta criada! Confirme pelo link que chegou no seu e-mail e depois entre aqui.", true);
        else if (err) msg(err);
        else return finish(false);
      } else {
        const err = await account.signIn(email, pass);
        if (err) msg(err);
        else return finish(false);
      }
    } catch {
      msg("Não consegui falar com o servidor de contas. Tente de novo.");
    } finally {
      go.disabled = false;
    }
  });
  setMode("in");

  // fundo: carros passando
  const cv = $<HTMLCanvasElement>(".loginbg");
  const g = cv.getContext("2d")!;
  const cars = TEAMS.map((t, i) => ({ img: carImage(t).canvas, x: -200 - i * 260, lane: i % 3, v: 520 + (i % 4) * 60 }));
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W * dpr) {
      cv.width = W * dpr;
      cv.height = H * dpr;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#0e1118";
    g.fillRect(0, 0, W, H);
    // reta com zebra e faixas
    const y0 = H * 0.78, rh = 120;
    g.fillStyle = "#3a3c42";
    g.fillRect(0, y0, W, rh);
    for (let x = -((now / 4) % 40); x < W; x += 40) {
      g.fillStyle = Math.floor((x + now / 4) / 40) % 2 ? "#d42a2a" : "#eee";
      g.fillRect(x, y0 - 6, 40, 6);
      g.fillRect(x, y0 + rh, 40, 6);
    }
    g.fillStyle = "rgba(255,255,255,.25)";
    for (let x = -((now / 2) % 80); x < W; x += 80) g.fillRect(x, y0 + rh / 2 - 1, 40, 2);
    for (const c of cars) {
      c.x += c.v * dt;
      if (c.x > W + 200) c.x = -200 - Math.random() * 900;
      const h = 30, w = (c.img.width / c.img.height) * h;
      g.drawImage(c.img, c.x, y0 + 14 + c.lane * 34, w, h);
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}

/** caixa com as estatísticas do jogador logado (no menu) */
export function statsHtml(): string {
  const p = account.profile;
  if (!p) return "";
  const s = { races: 0, wins: 0, podiums: 0, poles: 0, points: 0, dnfs: 0, titles: 0, champs: 0, best: null as number | null, ...p.stats };
  const item = (n: string | number, l: string) => `<div><b>${n}</b><span>${l}</span></div>`;
  return `<div class="statsgrid">
    ${item(s.races, "corridas")}${item(s.wins, "vitórias")}${item(s.podiums, "pódios")}${item(s.poles, "poles")}
    ${item(s.points, "pontos")}${item(s.titles, "títulos")}${item(s.best ? `${s.best}º` : "—", "melhor")}${item(s.dnfs, "abandonos")}
  </div><div class="hint" style="margin:6px 0 0">Conta: ${esc(account.user?.email ?? "")}</div>`;
}
