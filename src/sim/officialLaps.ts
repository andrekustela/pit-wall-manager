// Voltas da corrida oficial de cada pista (última corrida de F1 naquele traçado) e a escolha de
// corrida em percentual: 25%, 50%, 75% ou 100% das voltas oficiais, arredondando pra cima.
// A escolha fica guardada como número negativo (-25 = 25%) e vira voltas na hora de montar o fim
// de semana, com a pista dele (no campeonato, cada etapa tem a sua conta).
import { CIRCUITS, getTrack } from "./track";

/** pelo nome original da pista (o Editor pode renomear) */
const OFFICIAL: Record<string, number> = {
  "Albert Park": 58, "Austin (COTA)": 56, "Bahrein": 57, "Baku": 51, "Barcelona-Catalunya": 66,
  "Buenos Aires": 72, "Cidade do México": 71, "Estoril": 70, "Hockenheim": 67, "Hungaroring": 70,
  "Imola": 63, "Indianápolis": 73, "Interlagos": 71, "Istanbul Park": 58, "Jacarepaguá": 61,
  "Jeddah": 50, "Las Vegas": 50, "Lusail": 57, "Madring": 57, "Magny-Cours": 70, "Marina Bay": 62,
  "Miami": 57, "Monte Carlo": 78, "Montreal": 70, "Monza": 53, "Mugello": 59, "Nürburgring": 60,
  "Paul Ricard": 53, "Portimão": 66, "Red Bull Ring": 71, "Sepang": 56, "Silverstone": 52,
  "Sochi": 53, "Spa-Francorchamps": 44, "Suzuka": 53, "Watkins Glen": 59, "Xangai": 56,
  "Yas Marina": 58, "Zandvoort": 72,
};

/** voltas da corrida oficial; sem o número: a regra da FIA (o menor número que passa de 305 km) */
export function officialLaps(trackIndex: number): number {
  const def = CIRCUITS[trackIndex];
  const known = def && OFFICIAL[def.lineKey ?? def.name];
  if (known) return known;
  return Math.ceil(305000 / getTrack(trackIndex).L);
}

/** a escolha é um percentual das voltas oficiais? (guardada como negativo: -25 = 25%) */
export const isPct = (choice: number) => choice < 0;

/** escolha (voltas fixas ou percentual) -> voltas da corrida nesta pista */
export function resolveLaps(choice: number, trackIndex: number): number {
  if (!isPct(choice)) return choice;
  return Math.max(3, Math.ceil((officialLaps(trackIndex) * -choice) / 100));
}

/** texto do botão: "20 VOLTAS" ou "25%" */
export function lapChoiceLabel(choice: number): string {
  return isPct(choice) ? `${-choice}%` : `${choice} VOLTAS`;
}
