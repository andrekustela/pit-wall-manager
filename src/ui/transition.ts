// Transição entre telas com a faixa vermelha do menu: ela vai pra esquerda
// cobrindo a tela atual (por onde passa fica escuro) e, quando a tela nova já
// está montada, volta pra direita revelando ela.
import { flagCanvas } from "./flagField";
const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const TAN = Math.tan((18 * Math.PI) / 180);
/** faixa parada no menu: esquerda em 33vw, 9vw de largura, inclinada em volta de 55vh (igual ao CSS de .m2stripe) */
const REST_LEFT = 0.33, WIDTH = 0.09, CY = 0.55;
const COVER_MS = 600;
const REVEAL_MS = 900;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** evento: a faixa da transição chegou no lugar dela no menu e passou pra faixa do menu */
export const MENU_HANDOFF = "pwm:menuhandoff";

interface Cover {
  shade: HTMLDivElement;
  band: HTMLDivElement;
  timer: ReturnType<typeof setTimeout>;
}
let cover: Cover | null = null;

function make(): Cover {
  const shade = document.createElement("div");
  shade.className = "tshade";
  // a bandeira do fundo continua mexendo por baixo da faixa (é a mesma das telas, no mesmo ritmo)
  shade.appendChild(flagCanvas());
  const band = document.createElement("div");
  band.className = "tband";
  document.body.append(shade, band);
  // se a tela nova demorar demais, revela assim mesmo
  return { shade, band, timer: setTimeout(() => revealScreen(), 2500) };
}

/** posição do centro da faixa na altura y, com a faixa deslocada tx px do lugar de descanso */
const centerX = (tx: number, y: number) => window.innerWidth * (REST_LEFT + WIDTH / 2) + tx - TAN * (y - window.innerHeight * CY);
const place = (c: Cover, tx: number) => (c.band.style.transform = `translateX(${tx}px) skewX(-18deg)`);
/** sombra cobrindo o lado direito da faixa (o que ela já "apagou" ou ainda não revelou) */
const shadeRight = (c: Cover, tx: number) => {
  const H = window.innerHeight;
  c.shade.style.clipPath = `polygon(${centerX(tx, 0)}px 0, 100% 0, 100% 100%, ${centerX(tx, H)}px 100%)`;
};
const farLeft = () => -(window.innerWidth * (REST_LEFT + WIDTH) + window.innerHeight * TAN * 0.6 + 60);
const farRight = () => window.innerWidth * (1 - REST_LEFT) + window.innerHeight * TAN * 0.6 + 60;

/**
 * Cobre a tela: a faixa sai do lugar dela (no menu) e vai pra esquerda; tudo à direita
 * dela vai ficando escuro. Resolve quando a tela está toda coberta.
 */
export function coverScreen(fromRest = true): Promise<void> {
  if (reduce()) return Promise.resolve();
  if (cover) return Promise.resolve();
  const c = (cover = make());
  const start = fromRest ? 0 : farRight();
  const end = farLeft();
  return new Promise((done) => {
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / COVER_MS);
      const tx = start + (end - start) * easeInOut(k);
      place(c, tx);
      shadeRight(c, tx);
      if (k < 1) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  });
}

/**
 * Revela a tela nova: a faixa volta da esquerda pra direita e o escuro some por onde
 * ela passa. `toMenu` = para no lugar de descanso (a faixa do menu continua dali).
 */
export function revealScreen(toMenu = false) {
  if (reduce()) return;
  const c = cover ?? make();
  cover = null;
  clearTimeout(c.timer);
  const start = farLeft();
  const end = toMenu ? 0 : farRight();
  const t0 = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / REVEAL_MS);
    const tx = start + (end - start) * easeOut(k);
    place(c, tx);
    shadeRight(c, tx);
    if (k < 1) return void requestAnimationFrame(step);
    c.shade.remove();
    // voltando pro menu: a faixa do menu assume no mesmo lugar com o mesmo vermelho forte e vai
    // clareando (sem "sumir um vermelho e aparecer outro"); o fundo do menu continua com ela,
    // desenhando a pista
    const stripe = toMenu ? document.querySelector<HTMLElement>(".m2stripe:not(.m2fly)") : null;
    if (stripe) {
      stripe.classList.add("hot");
      requestAnimationFrame(() => requestAnimationFrame(() => stripe.classList.remove("hot")));
      window.dispatchEvent(new Event(MENU_HANDOFF));
    }
    c.band.remove();
  };
  // tela nova (ainda coberta) tem que estar desenhada antes de começar
  requestAnimationFrame(() => requestAnimationFrame(step));
}

/** a tela está coberta esperando a próxima? */
export function isCovered() {
  return !!cover;
}

/** troca de tela no meio do jogo: cobre na hora e revela a nova com a faixa */
export function wipe() {
  if (reduce() || cover) return;
  cover = make();
  place(cover, farLeft());
  shadeRight(cover, farLeft());
}

/** entrada da tela que acabou de ser montada */
export function enterScreen(root: HTMLElement) {
  const s = root.firstElementChild as HTMLElement | null;
  if (!s) return;
  s.classList.add("enter");
}
