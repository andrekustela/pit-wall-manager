// Animações da logo no menu: a cada 6–10 s sorteia um efeito curto (com tema de
// corrida) que sempre volta ao normal. Nunca repete o mesmo duas vezes seguidas.
const FX = ["brilho", "acelerada", "ronco", "passagem", "farol"] as const;
type Fx = (typeof FX)[number];

export function startLogoFx(wrap: HTMLElement) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const img = wrap.querySelector<HTMLImageElement>("img");
  if (!img) return;
  let last: Fx | null = null;
  let timer = 0;

  const run = (fx: Fx) => {
    switch (fx) {
      case "brilho":
        wrap.classList.remove("shine");
        void wrap.offsetWidth; // reinicia a animação do brilho
        wrap.classList.add("shine");
        break;
      case "acelerada":
        // inclina pra frente como na arrancada e assenta com um leve exagero
        img.animate(
          [
            { transform: "none" },
            { transform: "translateX(-6px) skewX(8deg)", offset: 0.18 },
            { transform: "translateX(10px) skewX(-10deg)", offset: 0.45 },
            { transform: "translateX(-2px) skewX(2deg)", offset: 0.75 },
            { transform: "none" },
          ],
          { duration: 760, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
        );
        break;
      case "ronco":
        // vibração do motor acelerando parado (curta e pequena)
        img.animate(
          Array.from({ length: 12 }, (_, i) => ({ transform: i === 11 ? "none" : `translate(${(i % 2 ? 1 : -1) * (2.2 - i * 0.18)}px, ${(i % 3) - 1}px)` })),
          { duration: 460, easing: "linear" },
        );
        break;
      case "passagem": {
        // rastro vermelho de velocidade cruzando o letreiro
        const s = document.createElement("i");
        s.className = "logostreak";
        wrap.appendChild(s);
        s.animate(
          [
            { transform: "translateX(-120%) skewX(-20deg)", opacity: 0 },
            { opacity: 1, offset: 0.25 },
            { transform: "translateX(260%) skewX(-20deg)", opacity: 0 },
          ],
          { duration: 620, easing: "cubic-bezier(0.77, 0, 0.175, 1)" },
        ).onfinish = () => s.remove();
        img.animate([{ transform: "none" }, { transform: "translateX(3px)", offset: 0.5 }, { transform: "none" }], { duration: 620, easing: "ease-out" });
        break;
      }
      case "farol":
        img.animate(
          [
            { filter: "drop-shadow(0 4px 18px rgba(52,160,255,.25))", transform: "scale(1)" },
            { filter: "drop-shadow(0 0 26px rgba(90,190,255,.9)) brightness(1.25)", transform: "scale(1.035)", offset: 0.3 },
            { filter: "drop-shadow(0 4px 18px rgba(52,160,255,.25))", transform: "scale(1)" },
          ],
          { duration: 900, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
        );
        break;
    }
  };

  const next = () => {
    if (!wrap.isConnected) return; // saiu do menu: para
    const options = FX.filter((f) => f !== last);
    const fx = options[Math.floor(Math.random() * options.length)];
    last = fx;
    run(fx);
    timer = window.setTimeout(next, 6000 + Math.random() * 4000);
  };
  // o primeiro efeito vem logo depois da entrada da logo
  timer = window.setTimeout(next, 2200);
  return () => clearTimeout(timer);
}
