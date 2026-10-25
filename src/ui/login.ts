// Tela de entrada: login por e-mail e senha (Firebase), criar conta, esqueci a
// senha ou jogar sem conta. Mesmo visual do menu (pista animada ao fundo).
import { account, accountsEnabled } from "../net/account";
import { CIRCUITS } from "../sim/track";
import { backdropMemo, mountMenuBackdrop } from "./menuBg";
import { coverScreen } from "./transition";
import { startLogoFx } from "./logoFx";
import { esc } from "./common";

export function showLogin(root: HTMLElement, onDone: (guest: boolean) => void) {
  let mode: "in" | "up" | "reset" = "in";
  const bgTrack = backdropMemo.v?.idx ?? Math.floor(Math.random() * CIRCUITS.length);
  if (!backdropMemo.v) backdropMemo.v = { idx: bgTrack, t0: performance.now() };
  root.innerHTML = `
    <div class="screen menu2 loginv2">
      <canvas class="menubg"></canvas>
      <div class="m2stripe"></div>
      <div class="m2">
        <div class="m2left">
          <div class="m2logowrap"><img class="m2logo" src="/brand/logo.png" alt="Pit Wall Manager"></div>
          <p class="m2tag">A estratégia de corrida é sua. <b>Você é o engenheiro-chefe.</b></p>
          <div class="m2stage"><div class="m2view lgview">
            <div class="seg logintabs"><button data-mode="in" class="on">ENTRAR</button><button data-mode="up">CRIAR CONTA</button></div>
            <form class="loginform">
              <label class="fld" data-only="up"><span>Nome do engenheiro</span><input class="txt" id="lg-name" maxlength="18" placeholder="Ex.: André" autocomplete="nickname"></label>
              <label class="fld" data-only="up"><span>Nome da equipe (opcional)</span><input class="txt" id="lg-team" maxlength="24" placeholder="Ex.: Kustela Racing"></label>
              <label class="fld"><span>E-mail</span><input class="txt" id="lg-email" type="email" autocomplete="email" required></label>
              <label class="fld" data-hide="reset"><span>Senha</span><input class="txt" id="lg-pass" type="password" minlength="6" autocomplete="current-password"></label>
              <div class="loginmsg" id="lg-msg"></div>
              <button class="m2btn hot" id="lg-go" type="submit"><b>ENTRAR</b><span id="lg-sub">Com e-mail e senha</span><i>▶</i></button>
            </form>
            <button class="m2btn google" id="lg-google"><svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg><b>ENTRAR COM GOOGLE</b><i>▶</i></button>
            <div class="loginlinks">
              <button class="linkbtn" id="lg-forgot">esqueci a senha</button>
              <button class="m2back" id="lg-guest">JOGAR SEM CONTA ▶</button>
            </div>
            <p class="hint lgnote">Com conta, seu perfil, suas estatísticas, recordes, amigos e campeonatos ficam salvos e você entra de qualquer computador. Nome e equipe dá pra trocar depois na ⚙.</p>
          </div></div>
        </div>
      </div>
      <div class="m2trackname"><span>PISTA EM DESTAQUE</span><b id="lg-trackname">${esc((CIRCUITS[bgTrack]?.name ?? "").toUpperCase())}</b></div>
    </div>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const msg = (t: string, ok = false) => {
    const m = $("#lg-msg");
    m.textContent = t;
    m.classList.toggle("ok", ok);
  };
  const setMode = (m: typeof mode) => {
    mode = m;
    root.querySelectorAll<HTMLElement>("[data-mode]").forEach((bt) => bt.classList.toggle("on", bt.dataset.mode === m));
    root.querySelectorAll<HTMLElement>("[data-only=up]").forEach((el) => (el.hidden = m !== "up"));
    root.querySelectorAll<HTMLElement>("[data-hide=reset]").forEach((el) => (el.hidden = m === "reset"));
    $("#lg-go").querySelector("b")!.textContent = m === "in" ? "ENTRAR" : m === "up" ? "CRIAR CONTA" : "MANDAR LINK PRO E-MAIL";
    $("#lg-sub").textContent = m === "in" ? "Com e-mail e senha" : m === "up" ? "Nome do engenheiro, e-mail e uma senha" : "Pra criar uma senha nova";
    $<HTMLInputElement>("#lg-pass").autocomplete = m === "up" ? "new-password" : "current-password";
    msg("");
  };
  root.querySelectorAll<HTMLElement>("[data-mode]").forEach((bt) => bt.addEventListener("click", () => setMode(bt.dataset.mode as typeof mode)));
  $("#lg-forgot").addEventListener("click", () => setMode("reset"));
  let leaving = false;
  // saída: a faixa cobre a tela indo pra esquerda e o menu é revelado
  const finish = (guest: boolean) => {
    if (leaving) return;
    leaving = true;
    stripe.style.opacity = "0";
    void coverScreen().then(() => onDone(guest));
  };
  $("#lg-guest").addEventListener("click", () => finish(true));
  $("#lg-google").addEventListener("click", async () => {
    if (!accountsEnabled()) return msg('As contas ainda não estão ligadas neste servidor. Use "jogar sem conta" por enquanto.');
    const bt = $<HTMLButtonElement>("#lg-google");
    bt.disabled = true;
    msg("Abrindo o Google...", true);
    const err = await account.signInGoogle().catch(() => "Não consegui falar com o Google.");
    bt.disabled = false;
    if (err) msg(err);
    else finish(false);
  });

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $<HTMLInputElement>("#lg-email").value.trim();
    const pass = $<HTMLInputElement>("#lg-pass").value;
    const name = $<HTMLInputElement>("#lg-name").value.trim();
    const team = $<HTMLInputElement>("#lg-team").value.trim();
    const go = $<HTMLButtonElement>("#lg-go");
    if (!accountsEnabled()) return msg('As contas ainda não estão ligadas neste servidor. Use "jogar sem conta" por enquanto.');
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
  startLogoFx($<HTMLElement>(".m2logowrap"));

  // fundo: a mesma pista animada do menu (continua nele depois de entrar)
  const stripe = $<HTMLElement>(".m2stripe");
  const nameEl = $<HTMLElement>("#lg-trackname");
  mountMenuBackdrop(
    $<HTMLCanvasElement>(".menubg"),
    bgTrack,
    stripe,
    (idx) => {
      const out = nameEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" });
      out.onfinish = () => {
        nameEl.textContent = (CIRCUITS[idx]?.name ?? "").toUpperCase();
        nameEl.animate([{ transform: "translateY(10px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 260, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" });
      };
    },
    undefined,
    undefined,
    backdropMemo.v.t0,
    (idx, t0) => (backdropMemo.v = { idx, t0 }),
  );
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
