// Transição entre telas: uma faixa vermelha inclinada atravessa a tela enquanto
// a tela nova aparece por baixo (sobe um pouco e ganha opacidade).
const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE = "cubic-bezier(0.77, 0, 0.175, 1)";

/** faixa atravessando a tela (não bloqueia clique) */
export function wipe() {
  if (reduce()) return;
  const el = document.createElement("div");
  el.className = "wipe";
  el.innerHTML = `<i></i><i></i><i></i>`;
  document.body.appendChild(el);
  const a = el.animate([{ transform: "translateX(-140vw) skewX(-18deg)" }, { transform: "translateX(140vw) skewX(-18deg)" }], {
    duration: 620,
    easing: EASE,
    fill: "forwards",
  });
  a.onfinish = () => el.remove();
}

/** entrada da tela que acabou de ser montada */
export function enterScreen(root: HTMLElement) {
  const s = root.firstElementChild as HTMLElement | null;
  if (!s) return;
  s.classList.add("enter");
}
