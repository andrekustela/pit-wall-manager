import { esc, storeGet, storeSet } from "./common";

export interface MenuChoice {
  mode: "solo" | "create" | "join";
  name: string;
  teamName: string;
  code?: string;
}

export function showMenu(root: HTMLElement, onChoose: (c: MenuChoice) => void) {
  const name = storeGet("pwm.name");
  const team = storeGet("pwm.team");
  root.innerHTML = `
    <div class="screen"><div class="wrap" style="max-width:720px">
      <h1 class="title">PIT WALL <span>MANAGER</span></h1>
      <p class="sub">Você é o engenheiro-chefe. Os pilotos correm, você decide o acerto e a estratégia.</p>
      <div class="box">
        <h3>SEU PERFIL</h3>
        <label class="fld"><span>Nome do engenheiro</span><input class="txt" id="m-name" maxlength="18" placeholder="Ex.: André" value="${esc(name)}"></label>
        <label class="fld"><span>Nome da equipe (opcional)</span><input class="txt" id="m-team" maxlength="24" placeholder="Ex.: Kustela Racing" value="${esc(team)}"></label>
      </div>
      <div class="cols" style="margin-top:12px">
        <div class="box">
          <h3>SOLO</h3>
          <p class="hint" style="margin-top:0">Você contra 9 equipes da IA, cada uma com um engenheiro sorteado (bom ou ruim).</p>
          <button class="btn primary" id="m-solo">JOGAR SOLO ▶</button>
        </div>
        <div class="box">
          <h3>ONLINE</h3>
          <p class="hint" style="margin-top:0">Crie uma sala e passe o código pros amigos. As equipes que sobrarem ficam com a IA.</p>
          <button class="btn primary" id="m-create">CRIAR SALA</button>
          <div style="display:flex;gap:6px;margin-top:10px">
            <input class="txt" id="m-code" maxlength="4" placeholder="CÓDIGO" style="text-transform:uppercase;width:120px">
            <button class="btn" id="m-join">ENTRAR</button>
          </div>
        </div>
      </div>
    </div></div>`;
  const get = () => {
    const n = root.querySelector<HTMLInputElement>("#m-name")!.value.trim();
    const t = root.querySelector<HTMLInputElement>("#m-team")!.value.trim();
    storeSet("pwm.name", n);
    storeSet("pwm.team", t);
    return { name: n || "Engenheiro", teamName: t };
  };
  root.querySelector("#m-solo")!.addEventListener("click", () => onChoose({ mode: "solo", ...get() }));
  root.querySelector("#m-create")!.addEventListener("click", () => onChoose({ mode: "create", ...get() }));
  const join = () => {
    const code = root.querySelector<HTMLInputElement>("#m-code")!.value.trim().toUpperCase();
    if (code.length === 4) onChoose({ mode: "join", code, ...get() });
  };
  root.querySelector("#m-join")!.addEventListener("click", join);
  root.querySelector("#m-code")!.addEventListener("keydown", (e) => (e as KeyboardEvent).key === "Enter" && join());
}
