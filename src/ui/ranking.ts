// Ranking entre amigos (contas do jogo): classificação geral e recordes de volta
// por pista. Os dados vêm da coleção pública "leaderboard" do Firestore.
import { account, type RankRow } from "../net/account";
import { fmtLap } from "../sim/race";
import { CIRCUITS } from "../sim/track";
import { esc } from "./common";

export async function showRanking() {
  const m = document.createElement("div");
  m.className = "helpmodal";
  m.innerHTML = `<div class="helpbox panel rankbox"><div class="helphead"><b>🏆 RANKING ENTRE AMIGOS</b><button class="btn small" data-close>✕</button></div><div class="rankbody"><p class="hint">Carregando…</p></div></div>`;
  document.body.appendChild(m);
  const close = () => {
    m.remove();
    window.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
  window.addEventListener("keydown", onKey, true);
  m.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === m || t.closest("[data-close]")) close();
  });
  const body = m.querySelector<HTMLElement>(".rankbody")!;
  let rows: RankRow[] | null;
  try {
    rows = await account.ranking();
  } catch {
    body.innerHTML = `<p class="hint">Não consegui carregar o ranking agora. Tente de novo.</p>`;
    return;
  }
  if (rows === null) {
    body.innerHTML = `<p class="hint">O ranking ainda não foi liberado no Firebase: falta acrescentar a regra da coleção <b>leaderboard</b> (veja o arquivo firestore.rules do projeto).</p>`;
    return;
  }
  if (!rows.length) {
    body.innerHTML = `<p class="hint">Ninguém no ranking ainda. Termine uma corrida logado pra aparecer aqui.</p>`;
    return;
  }
  const me = account.user?.uid;
  let tab: "geral" | "recordes" = "geral";
  const render = () => {
    const geral = [...rows!]
      .sort((a, b) => b.stats.titles - a.stats.titles || b.stats.wins - a.stats.wins || b.stats.podiums - a.stats.podiums || b.stats.points - a.stats.points)
      .map(
        (r, i) => `<tr class="${r.id === me ? "player" : ""}"><td>${i + 1}</td><td><b>${esc(r.name)}</b><div class="hint" style="margin:0">${esc(r.team_name || "")}</div></td>
          <td class="num">${r.stats.titles}</td><td class="num">${r.stats.wins}</td><td class="num">${r.stats.podiums}</td><td class="num">${r.stats.poles}</td><td class="num">${r.stats.points}</td><td class="num">${r.stats.races}</td></tr>`,
      )
      .join("");
    // recorde de cada pista: o melhor entre todos
    const recs = CIRCUITS.map((c, i) => {
      let best: { time: number; driver: string; who: string; mine: boolean } | null = null;
      for (const r of rows!) {
        const l = r.laps[String(i)];
        if (l && (!best || l.time < best.time)) best = { ...l, who: r.name, mine: r.id === me };
      }
      return best ? { name: c.name, ...best } : null;
    }).filter((x) => !!x);
    const recordes = recs.length
      ? recs.map((r) => `<tr class="${r!.mine ? "player" : ""}"><td>${esc(r!.name)}</td><td class="num"><b>${fmtLap(r!.time)}</b></td><td>${esc(r!.driver)}</td><td>${esc(r!.who)}</td></tr>`).join("")
      : `<tr><td colspan="4" class="hint">Nenhum recorde ainda.</td></tr>`;
    body.innerHTML = `<div class="seg" style="margin-bottom:10px"><button data-rt="geral" class="${tab === "geral" ? "on" : ""}">CLASSIFICAÇÃO</button><button data-rt="recordes" class="${tab === "recordes" ? "on" : ""}">RECORDES DE VOLTA</button></div>
      ${tab === "geral"
        ? `<table class="results"><tr><th>#</th><th>ENGENHEIRO</th><th>TÍTULOS</th><th>VITÓRIAS</th><th>PÓDIOS</th><th>POLES</th><th>PONTOS</th><th>CORRIDAS</th></tr>${geral}</table>`
        : `<table class="results"><tr><th>PISTA</th><th>RECORDE</th><th>PILOTO</th><th>ENGENHEIRO</th></tr>${recordes}</table>`}`;
    body.querySelectorAll<HTMLElement>("[data-rt]").forEach((b) =>
      b.addEventListener("click", () => {
        tab = b.dataset.rt as typeof tab;
        render();
      }),
    );
  };
  render();
}
