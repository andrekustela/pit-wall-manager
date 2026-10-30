// Atalhos de teclado do jogo (Configurações > ATALHOS): cada ação tem uma tecla padrão e o jogador pode
// trocar. Guarda o código físico da tecla (KeyboardEvent.code: "KeyQ", "Digit1", "F2"...), o mesmo em
// qualquer layout de teclado.
import { storeGet, storeSet } from "./common";

export type Action =
  | "pausa" | "vel1" | "vel2" | "vel3" | "vel4" | "vel5"
  | "cam1" | "cam2" | "cam3" | "cam4"
  | "painel" | "tabela" | "tv" | "trocarCarro"
  | "box" | "ritmoAtacar" | "ritmoNormal" | "ritmoPoupar" | "motorRica" | "motorNormal" | "motorPobre"
  | "musica" | "microfone" | "telaCheia";

export const ACTIONS: { id: Action; label: string; group: string; def: string }[] = [
  { id: "pausa", label: "Pausar / continuar", group: "Corrida", def: "Space" },
  { id: "vel1", label: "Velocidade 1x", group: "Corrida", def: "F1" },
  { id: "vel2", label: "Velocidade 2x", group: "Corrida", def: "F2" },
  { id: "vel3", label: "Velocidade 4x", group: "Corrida", def: "F3" },
  { id: "vel4", label: "Velocidade 8x", group: "Corrida", def: "F4" },
  { id: "vel5", label: "Velocidade 16x", group: "Corrida", def: "F5" },
  { id: "cam1", label: "Câmera de cima", group: "Câmeras (carros 3D)", def: "Digit1" },
  { id: "cam2", label: "Câmera de lado", group: "Câmeras (carros 3D)", def: "Digit2" },
  { id: "cam3", label: "Câmera atrás do carro", group: "Câmeras (carros 3D)", def: "Digit3" },
  { id: "cam4", label: "Câmera piloto", group: "Câmeras (carros 3D)", def: "Digit4" },
  { id: "painel", label: "Painel dos pilotos (completo / compacto / só nomes)", group: "Tela", def: "KeyM" },
  { id: "tabela", label: "Tabela de posições menor", group: "Tela", def: "KeyP" },
  { id: "tv", label: "Modo TV", group: "Tela", def: "KeyT" },
  { id: "trocarCarro", label: "Seguir o outro carro da equipe", group: "Tela", def: "Tab" },
  { id: "telaCheia", label: "Tela cheia", group: "Tela", def: "KeyF" },
  { id: "box", label: "Chamar pro box / cancelar", group: "Piloto seguido", def: "KeyB" },
  { id: "ritmoAtacar", label: "Ritmo: atacar", group: "Piloto seguido", def: "KeyQ" },
  { id: "ritmoNormal", label: "Ritmo: normal", group: "Piloto seguido", def: "KeyW" },
  { id: "ritmoPoupar", label: "Ritmo: poupar", group: "Piloto seguido", def: "KeyE" },
  { id: "motorRica", label: "Motor: rica", group: "Piloto seguido", def: "KeyZ" },
  { id: "motorNormal", label: "Motor: normal", group: "Piloto seguido", def: "KeyX" },
  { id: "motorPobre", label: "Motor: pobre", group: "Piloto seguido", def: "KeyC" },
  { id: "musica", label: "Próxima música (com Shift: a anterior)", group: "Som", def: "KeyN" },
  { id: "microfone", label: "Falar no rádio (segurar)", group: "Som", def: "KeyV" },
];

let map: Record<string, string> | null = null;
const load = () => {
  if (map) return map;
  try {
    map = JSON.parse(storeGet("pwm.atalhos") || "{}");
  } catch {
    map = {};
  }
  return map!;
};

/** a tecla (código) de uma ação */
export function keyOf(a: Action): string {
  return load()[a] ?? ACTIONS.find((x) => x.id === a)!.def;
}
/** este evento é a tecla da ação? */
export const isKey = (e: KeyboardEvent, a: Action) => e.code === keyOf(a);
/** a ação desta tecla (ou nada) */
export function actionOf(e: KeyboardEvent): Action | null {
  return ACTIONS.find((x) => keyOf(x.id) === e.code)?.id ?? null;
}

/** troca a tecla; se outra ação usava ela, as duas trocam de tecla (devolve qual) */
export function setKey(a: Action, code: string): Action | null {
  const m = load();
  const other = ACTIONS.find((x) => x.id !== a && keyOf(x.id) === code)?.id ?? null;
  if (other) m[other] = keyOf(a);
  m[a] = code;
  storeSet("pwm.atalhos", JSON.stringify(m));
  return other;
}
export function resetKeys() {
  map = {};
  storeSet("pwm.atalhos", "{}");
}

/** nome da tecla pra mostrar ("Q", "1", "F2", "Espaço") */
export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  return ({ Space: "Espaço", Tab: "Tab", Enter: "Enter", Backspace: "Backspace", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/", Semicolon: "Ç", BracketLeft: "´", BracketRight: "[", Backquote: "'", Quote: "~", IntlRo: "/" } as Record<string, string>)[code] ?? code;
}
export const keyName = (a: Action) => keyLabel(keyOf(a));
