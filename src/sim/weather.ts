// Clima: linha do tempo de chuva em "voltas de corrida" (gerada pela seed)
// e uma previsão imprecisa para o jogador.
import { Rng } from "./rng";

export interface RainSpell {
  start: number; // volta (fracionária) em que começa
  end: number;
  intensity: number; // 0..1
}

export interface Forecast {
  /** chance mostrada ao jogador (%) */
  chance: number;
  /** janela prevista (voltas), pode estar errada */
  from: number;
  to: number;
  label: string;
}

export interface WeatherPlan {
  spells: RainSpell[];
  /** pista molhada no treino livre e na classificação (0..1) */
  practiceWet: number;
  qualiWet: number;
  /** pista molhada na largada */
  startWet: number;
  forecast: Forecast | null;
}

export function makeWeather(seed: number, laps: number, rainChance: number): WeatherPlan {
  const rng = new Rng(seed ^ 0x9e3779b9);
  const spells: RainSpell[] = [];
  const rains = rng.chance(rainChance);
  if (rains) {
    const n = rng.chance(0.3) ? 2 : 1;
    let cursor = rng.range(-laps * 0.1, laps * 0.55);
    for (let i = 0; i < n; i++) {
      const len = rng.range(laps * 0.15, laps * 0.4);
      spells.push({ start: cursor, end: cursor + len, intensity: rng.range(0.35, 1) });
      cursor += len + rng.range(laps * 0.15, laps * 0.3);
    }
  }
  const startRain = spells.find((s) => s.start <= 0 && s.end > 0);
  const startWet = startRain ? Math.min(1, startRain.intensity * rng.range(0.6, 1)) : 0;
  const qualiWet = rng.chance(rainChance * 0.45) ? rng.range(0.3, 0.9) : startWet * rng.range(0.4, 1);

  let forecast: Forecast | null = null;
  const first = spells[0];
  if (first) {
    const fuzz = laps * 0.12;
    const from = Math.max(1, Math.round(first.start + rng.gauss(fuzz)));
    const to = Math.max(from + 1, Math.round(first.end + rng.gauss(fuzz)));
    const chance = Math.round(rng.range(55, 95) / 5) * 5;
    forecast = { chance, from, to, label: first.intensity > 0.7 ? "chuva forte" : "chuva" };
  } else if (rng.chance(0.25)) {
    // previsão errada de vez em quando
    const from = Math.round(rng.range(2, laps * 0.7));
    forecast = { chance: Math.round(rng.range(15, 40) / 5) * 5, from, to: from + Math.round(laps * 0.2), label: "chuva fraca" };
  }
  const practiceWet = rng.chance(rainChance * 0.4) ? rng.range(0.25, 0.8) : 0;
  return { spells, practiceWet: Math.round(practiceWet * 100) / 100, qualiWet: Math.round(qualiWet * 100) / 100, startWet, forecast };
}

export function rainAt(plan: WeatherPlan, raceLap: number): number {
  for (const s of plan.spells) {
    if (raceLap >= s.start && raceLap < s.end) {
      // entra e sai gradualmente
      const ramp = Math.min(1, (raceLap - s.start) / 0.8, (s.end - raceLap) / 0.8);
      return s.intensity * Math.max(0.15, ramp);
    }
  }
  return 0;
}

export function forecastText(plan: { forecast: Forecast | null }): string {
  const f = plan.forecast;
  if (!f) return "Sem chuva prevista.";
  return `${f.chance}% de chance de ${f.label} entre as voltas ${f.from} e ${f.to}.`;
}
