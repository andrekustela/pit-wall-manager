// Marcha e giro mostrados (velocímetro da câmera piloto, onboard, telinha do volante). Como num F1: 8
// marchas com a velocidade máxima de cada uma (as baixas curtas, as altas longas); sobe perto do corte de
// giro e só reduz quando a velocidade cai bem abaixo da marcha de baixo (sem ficar indo e voltando numa
// curva), e no mínimo 0,25 s entre uma troca e outra. Atrás do safety car ("modo SC") o piloto sobe cedo e
// anda em marcha alta e giro baixo. Só desenho: a corrida não usa marcha.

/** velocidade máxima (km/h) de cada marcha, 1ª a 8ª */
const TOP = [105, 140, 170, 200, 230, 262, 295, 345];

const st = new Map<string, { g: number; t: number }>();

/** marcha ("N" parado) e giro (0..1 dentro da marcha) do carro `id` a `kmh` */
export function gearOf(id: string, kmh: number, sc = false): { gear: string; rev: number } {
  const now = performance.now();
  if (kmh < 4) {
    st.set(id, { g: 0, t: now });
    return { gear: "N", rev: kmh / 20 };
  }
  let s = st.get(id);
  if (!s) st.set(id, (s = { g: 1, t: 0 }));
  if (s.g === 0) s.g = 1;
  // sobe a ~96% da marcha (no SC a ~70%: troca cedo), reduz quando cai a ~82% da marcha de baixo
  const up = sc ? 0.7 : 0.96, down = sc ? 0.55 : 0.82;
  if (now - s.t > 250) {
    if (s.g < 8 && kmh > TOP[s.g - 1] * up) {
      s.g++;
      s.t = now;
    } else if (s.g > 1 && kmh < TOP[s.g - 2] * down) {
      s.g--;
      s.t = now;
    }
  }
  // (giro: do começo útil da marcha até o máximo dela)
  const lo = s.g > 1 ? TOP[s.g - 2] * 0.75 : 0, hi = TOP[s.g - 1];
  return { gear: String(s.g), rev: Math.max(0, Math.min(1, (kmh - lo) / (hi - lo))) };
}
