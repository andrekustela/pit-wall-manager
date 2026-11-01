// Desenhos do capacete e do macacão (na ordem de HELMET_STYLES / SUIT_STYLES em sim/livery.ts): onde fica a cor
// do detalhe, pela posição q (-1..1: x = lado, y = altura, z = frente; o capacete endireitado, o macacão no
// corpo). Cada regra vem em GLSL (3D: cars3dReal) e em JS (o capacete do carro estilizado, visto de cima) —
// as duas iguais, pra prévia ser o que aparece na corrida.
type Q = { x: number; y: number; z: number };
const fl = Math.floor, fr = (v: number) => v - Math.floor(v);

export const HELMET_RULES: { glsl: string; js: (q: Q) => boolean }[] = [
  { glsl: "false", js: () => false },
  { glsl: "abs(q.x) < 0.13 && q.y > -0.3", js: (q) => Math.abs(q.x) < 0.13 && q.y > -0.3 },
  { glsl: "abs(q.x) > 0.2 && abs(q.x) < 0.36 && q.y > -0.3", js: (q) => Math.abs(q.x) > 0.2 && Math.abs(q.x) < 0.36 && q.y > -0.3 },
  { glsl: "q.y > 0.25", js: (q) => q.y > 0.25 },
  { glsl: "q.z > 0.25", js: (q) => q.z > 0.25 },
  { glsl: "abs(q.y - 0.05) < 0.12", js: (q) => Math.abs(q.y - 0.05) < 0.12 },
  { glsl: "abs(q.x) > 0.6", js: (q) => Math.abs(q.x) > 0.6 },
  {
    glsl: "q.z > 0.35 && q.y > -0.35 && q.y < 0.3 && !(q.z > 0.55 && q.y > -0.2 && q.y < 0.18)",
    js: (q) => q.z > 0.35 && q.y > -0.35 && q.y < 0.3 && !(q.z > 0.55 && q.y > -0.2 && q.y < 0.18),
  },
  { glsl: "mod(floor(q.x * 5.0) + floor(q.y * 5.0) + floor(q.z * 5.0), 2.0) > 0.5", js: (q) => (((fl(q.x * 5) + fl(q.y * 5) + fl(q.z * 5)) % 2) + 2) % 2 === 1 },
  { glsl: "fract((q.x + q.y) * 3.0) < 0.35", js: (q) => fr((q.x + q.y) * 3) < 0.35 },
  { glsl: "length(fract(vec2(q.x * 4.0, q.y * 4.0 + q.z * 2.0)) - 0.5) < 0.22", js: (q) => Math.hypot(fr(q.x * 4) - 0.5, fr(q.y * 4 + q.z * 2) - 0.5) < 0.22 },
  { glsl: "q.x > 0.0", js: (q) => q.x > 0 },
];

/**
 * macacão: q = onde o ponto fica no corpo (-1..1: x lado, y altura, z frente), n = pra que lado a superfície
 * aponta, part = 1 no braço e 0 no resto (-1 = não se sabe: o piloto sentado do carro só tem a caixa da malha,
 * e aí vale a regra aproximada da direita). No piloto em pé, de braços
 * abaixados (viewer3dScene.bodySpace), medido: quadril q.y 0,0 · cintura 0,16 · peito 0,50 · ombro 0,68 ·
 * mãos penduradas 0,08 (por isso cintura, peito e pernas deixam os braços de fora)
 */
export const SUIT_RULES: { glsl: string; js: (q: Q, n: Q, part: number) => boolean }[] = [
  { glsl: "false", js: () => false },
  // faixas laterais: a lateral de fora de cada parte (tronco, braços, pernas)
  { glsl: "n.x * sign(q.x) > 0.82", js: (q, n) => n.x * Math.sign(q.x) > 0.82 },
  // ombros
  { glsl: "(part > -0.5 && q.y > 0.6) || (part < -0.5 && q.y > 0.45)", js: (q, n, p) => (p > -0.5 && q.y > 0.6) || (p < -0.5 && q.y > 0.45) },
  // cintura
  {
    glsl: "(part > -0.5 && part < 0.5 && abs(q.y - 0.16) < 0.05) || (part < -0.5 && abs(q.y + 0.05) < 0.08)",
    js: (q, n, p) => (p > -0.5 && p < 0.5 && Math.abs(q.y - 0.16) < 0.05) || (p < -0.5 && Math.abs(q.y + 0.05) < 0.08),
  },
  // pernas: da cintura pra baixo
  {
    glsl: "(part > -0.5 && part < 0.5 && q.y < 0.1) || (part < -0.5 && q.y < -0.35)",
    js: (q, n, p) => (p > -0.5 && p < 0.5 && q.y < 0.1) || (p < -0.5 && q.y < -0.35),
  },
  // faixa no peito
  {
    glsl: "(part > -0.5 && part < 0.5 && abs(q.y - 0.5) < 0.045) || (part < -0.5 && abs(q.y - 0.3) < 0.07)",
    js: (q, n, p) => (p > -0.5 && p < 0.5 && Math.abs(q.y - 0.5) < 0.045) || (p < -0.5 && Math.abs(q.y - 0.3) < 0.07),
  },
  { glsl: "fract((q.x + q.y) * 1.5) < 0.3", js: (q) => fr((q.x + q.y) * 1.5) < 0.3 },
  { glsl: "mod(floor(q.x * 4.0) + floor(q.y * 6.0), 2.0) > 0.5", js: (q) => (((fl(q.x * 4) + fl(q.y * 6)) % 2) + 2) % 2 === 1 },
  { glsl: "q.x > 0.0", js: (q) => q.x > 0 },
];

/**
 * luvas (na ordem de GLOVE_STYLES): gt = do pulso (0) à ponta dos dedos (1), negativo no punho que sobe pelo
 * antebraço; gf = 1 nos dedos; gb = pra onde a superfície aponta (1 = costas da mão, -1 = palma); gs = lado
 * (+1 esquerdo). No piloto em pé pelo esqueleto (mão, dedos e pulso); no sentado do carro, pela distância até
 * as manoplas do volante (aproximado: a mão inteira em volta da manopla)
 */
type G = { t: number; f: number; b: number; s: number };
export const GLOVE_RULES: { glsl: string; js: (g: G) => boolean }[] = [
  { glsl: "false", js: () => false },
  { glsl: "gf > 0.5", js: (g) => g.f > 0.5 },
  { glsl: "gt < 0.02", js: (g) => g.t < 0.02 },
  { glsl: "gb > 0.15 && gf < 0.5 && gt >= 0.02", js: (g) => g.b > 0.15 && g.f < 0.5 && g.t >= 0.02 },
  { glsl: "gb < -0.15 && gt >= 0.02", js: (g) => g.b < -0.15 && g.t >= 0.02 },
  { glsl: "gt > 0.86", js: (g) => g.t > 0.86 },
  { glsl: "fract(gt * 5.0) < 0.4", js: (g) => fr(g.t * 5) < 0.4 },
  { glsl: "mod(floor(gt * 6.0) + floor(gb * 2.5 + 3.0), 2.0) > 0.5", js: (g) => (((fl(g.t * 6) + fl(g.b * 2.5 + 3)) % 2) + 2) % 2 === 1 },
  { glsl: "gs > 0.0", js: (g) => g.s > 0 },
];

/**
 * tênis (na ordem de SHOE_STYLES): ft = do calcanhar (0) ao bico (1), fh = da sola (0) ao cano (1), fs = lado
 * (+1 o pé esquerdo), fp = parte (0 cabedal, 1 faixa, 2 sola). Só o cabedal leva o desenho; a faixa fica no
 * detalhe e a sola preta (menos em "Sola colorida")
 */
type F = { t: number; h: number; s: number; p: number };
export const SHOE_RULES: { glsl: string; js: (f: F) => boolean }[] = [
  { glsl: "false", js: () => false },
  { glsl: "ft > 0.72", js: (f) => f.t > 0.72 },
  { glsl: "ft < 0.26", js: (f) => f.t < 0.26 },
  { glsl: "fh > 0.62", js: (f) => f.h > 0.62 },
  { glsl: "fp > 1.5", js: (f) => f.p > 1.5 },
  { glsl: "fh > 0.3 && fh < 0.5", js: (f) => f.h > 0.3 && f.h < 0.5 },
  { glsl: "fract(ft * 6.0) < 0.4", js: (f) => fr(f.t * 6) < 0.4 },
  { glsl: "mod(floor(ft * 6.0) + floor(fh * 4.0), 2.0) > 0.5", js: (f) => (((fl(f.t * 6) + fl(f.h * 4)) % 2) + 2) % 2 === 1 },
  { glsl: "fs > 0.0", js: (f) => f.s > 0 },
];
