// Onde cada peça danificada custa tempo, em vez de um número fixo por volta:
// - asa dianteira: menos pressão na frente, sai de frente nas curvas lentas e médias (e na entrada)
// - asa traseira: menos pressão atrás, perde nas curvas rápidas e na tração da saída
// - suspensão dianteira: freada e entrada de curva
// - suspensão traseira: tração na saída de curva
// Assim a mesma asa quebrada custa mais em Mônaco que em Monza. O valor guardado em c.dmg é o
// custo numa pista "média"; partLoss() dá o custo nesta pista, nas condições de agora.
import type { PartId } from "./parts";

export interface DamageMap {
  /** peso da peça em cada metro da pista (0 = não pesa ali) */
  w: Record<PartId, Float32Array>;
  /** fração do tempo de volta em que a peça pesa (ponderada) */
  frac: Record<PartId, number>;
}

/** fração média entre as pistas reais (medida com scripts): numa pista média, perda = valor nominal */
export const DMG_REF: Record<PartId, number> = { fw: 0.688, rw: 0.813, suspF: 0.596, suspR: 0.794 };

/** quanto a chuva aumenta o estrago (aerodinâmica faz mais falta com pouca aderência) */
export function dmgWetMult(part: PartId, wet: number): number {
  return 1 + (part === "fw" || part === "rw" ? 0.6 : 0.3) * wet;
}

/** monta o mapa a partir do perfil de velocidade da pista (m/s por metro) */
export function damageMap(v: Float32Array): DamageMap {
  const n = v.length;
  const mk = () => new Float32Array(n);
  const w = { fw: mk(), rw: mk(), suspF: mk(), suspR: mk() };
  const time = { fw: 0, rw: 0, suspF: 0, suspR: 0 };
  let lap = 0;
  for (let i = 0; i < n; i++) {
    const s = v[i], ahead = v[(i + 15) % n];
    const slow = s < 50, fast = s >= 50 && s < 72;
    const braking = ahead < s - 1;
    const exit = s < 80 && ahead > s + 1;
    w.fw[i] = (slow ? 1 : fast ? 0.8 : 0) + (braking ? 0.3 : 0);
    w.rw[i] = (slow ? 0.5 : fast ? 1 : 0) + (exit ? 0.5 : 0);
    w.suspF[i] = (braking ? 1 : 0) + (slow || fast ? 0.6 : 0);
    w.suspR[i] = (exit ? 1 : 0) + (slow || fast ? 0.5 : 0);
    const dt = 1 / Math.max(1, s);
    lap += dt;
    for (const p of ["fw", "rw", "suspF", "suspR"] as PartId[]) time[p] += w[p][i] * dt;
  }
  return { w, frac: { fw: time.fw / lap, rw: time.rw / lap, suspF: time.suspF / lap, suspR: time.suspR / lap } };
}

/** segundos por volta que esse dano custa nesta pista, com essa água */
export function partLoss(map: DamageMap, part: PartId, nominal: number, wet: number): number {
  // 1,07: a perda medida dirigindo sai um pouco acima da conta direta (freada e retomada)
  return (1.07 * nominal * dmgWetMult(part, wet) * map.frac[part]) / DMG_REF[part];
}
