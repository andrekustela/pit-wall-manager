// Base de ~100 pilotos fictícios (sempre os mesmos, gerados por seed fixa),
// cada um com ficha própria: idade, nacionalidade, atributos, estilo e
// preferências de acerto. A cada jogo novo eles são sorteados pras equipes.
import { TEAMS } from "./data";
import { Rng } from "./rng";
import type { Driver } from "./types";

export interface DriverProfile {
  id: string;
  name: string;
  short: string;
  nat: string; // bandeira
  country: string;
  age: number;
  /** atributos 0..100 */
  pace: number;
  consistency: number;
  aggression: number;
  tyreCare: number;
  wet: number;
  overtaking: number;
  defending: number;
  /** quão bem ele explica o carro no rádio (acerto) */
  feedback: number;
  /** gosta de traseira solta (+) ou de carro mais "preso" na frente (−), em pontos 0..100 da asa */
  balancePref: number;
  /** gosta de suspensão mais dura (+) ou mais macia (−) */
  stiffPref: number;
  rating: number;
  style: string;
}

const NATIONS: { nat: string; country: string; first: string[]; last: string[]; w: number }[] = [
  { nat: "🇧🇷", country: "Brasil", w: 10, first: ["Rafael", "Lucas", "Bruno", "Diego", "Thiago", "Gabriel", "Felipe", "Caio", "Murilo", "Enzo", "Vitor", "Igor"], last: ["Moreira", "Brandão", "Calixto", "Vieira", "Santana", "Prado", "Teixeira", "Barros", "Azevedo", "Falcão", "Rezende", "Lacerda"] },
  { nat: "🇮🇹", country: "Itália", w: 9, first: ["Marco", "Luca", "Matteo", "Giulio", "Andrea", "Riccardo", "Paolo", "Davide"], last: ["Moretti", "Bellandi", "Rinaldi", "Ferraro", "Conti", "Galli", "Marchetti", "Lombardi"] },
  { nat: "🇬🇧", country: "Reino Unido", w: 10, first: ["Oliver", "Harry", "Jack", "George", "Callum", "Ethan", "Lewis", "Finn"], last: ["Callahan", "Ashby", "Whitmore", "Hale", "Fletcher", "Barker", "Sutton", "Hughes"] },
  { nat: "🇫🇷", country: "França", w: 8, first: ["Henri", "Théo", "Julien", "Hugo", "Pierre", "Lucas", "Antoine", "Mathis"], last: ["Dubois", "Lambert", "Fontaine", "Moreau", "Girard", "Rousseau", "Lefèvre", "Blanc"] },
  { nat: "🇩🇪", country: "Alemanha", w: 9, first: ["Nico", "Lukas", "Felix", "Jonas", "Max", "Leon", "Tobias", "Paul"], last: ["Hartmann", "Brenner", "Weiss", "Becker", "Kraus", "Vogel", "Schulz", "Richter"] },
  { nat: "🇪🇸", country: "Espanha", w: 8, first: ["Mateo", "Pablo", "Diego", "Álvaro", "Sergio", "Iker", "Javier", "Raúl"], last: ["Ríos", "Herrera", "Navarro", "Durán", "Ortega", "Molina", "Castro", "Vidal"] },
  { nat: "🇳🇱", country: "Holanda", w: 5, first: ["Daan", "Sem", "Luuk", "Jesse", "Bram"], last: ["de Vries", "Bakker", "Visser", "Smit", "Jansen"] },
  { nat: "🇯🇵", country: "Japão", w: 6, first: ["Kenji", "Yuto", "Haruto", "Ren", "Sora", "Takumi"], last: ["Arai", "Mori", "Sato", "Ito", "Tanaka", "Kobayashi"] },
  { nat: "🇸🇪", country: "Suécia", w: 4, first: ["Oskar", "Elias", "Viktor", "Axel"], last: ["Lindqvist", "Halvorsen", "Nyberg", "Ekström"] },
  { nat: "🇺🇸", country: "EUA", w: 6, first: ["Tyler", "Logan", "Cole", "Ryan", "Mason"], last: ["Carter", "Brooks", "Hayes", "Reed", "Walker"] },
  { nat: "🇦🇷", country: "Argentina", w: 5, first: ["Santiago", "Franco", "Tomás", "Nicolás", "Agustín"], last: ["Ferreyra", "Sosa", "Benítez", "Acosta", "Ledesma"] },
  { nat: "🇲🇽", country: "México", w: 4, first: ["Emilio", "Rodrigo", "Andrés", "Iván"], last: ["Garza", "Treviño", "Salinas", "Cantú"] },
  { nat: "🇦🇺", country: "Austrália", w: 4, first: ["Liam", "Noah", "Jake", "Cooper"], last: ["Doyle", "Mitchell", "Kerr", "Lawson"] },
  { nat: "🇫🇮", country: "Finlândia", w: 3, first: ["Aleksi", "Mikko", "Valtteri"], last: ["Virtanen", "Mäkinen", "Koskinen"] },
  { nat: "🇵🇹", country: "Portugal", w: 3, first: ["Tomás", "Duarte", "Rui"], last: ["Tavares", "Sousa", "Fonseca"] },
  { nat: "🇳🇬", country: "Nigéria", w: 2, first: ["Amara", "Tobi", "Chidi"], last: ["Okafor", "Adeyemi", "Eze"] },
  { nat: "🇮🇳", country: "Índia", w: 2, first: ["Arjun", "Rohan", "Kabir"], last: ["Mehta", "Rao", "Kapoor"] },
  { nat: "🇨🇦", country: "Canadá", w: 3, first: ["Owen", "Nathan", "Dylan"], last: ["Tremblay", "Gagnon", "Roy"] },
];

const clamp = (x: number) => Math.round(Math.max(20, Math.min(99, x)));

function styleOf(p: Omit<DriverProfile, "style" | "rating">): string {
  const traits: [number, string][] = [
    [p.aggression - 72, "Agressivo"],
    [p.consistency - 82, "Metódico"],
    [p.tyreCare - 82, "Cuida dos pneus"],
    [p.wet - 84, "Rei da chuva"],
    [p.pace - 86, "Veloz"],
    [p.overtaking - 84, "Ultrapassador"],
    [p.defending - 84, "Muralha"],
    [p.feedback - 85, "Ótimo de acerto"],
    [30 - p.aggression, "Cauteloso"],
  ];
  traits.sort((a, b) => b[0] - a[0]);
  return traits[0][0] > 0 ? traits[0][1] : "Equilibrado";
}

function buildPool(): DriverProfile[] {
  const rng = new Rng(20261017);
  const total = NATIONS.reduce((a, n) => a + n.w, 0);
  const used = new Set<string>();
  const shorts = new Set<string>();
  const out: DriverProfile[] = [];
  while (out.length < 100) {
    let r = rng.next() * total;
    const n = NATIONS.find((x) => (r -= x.w) < 0)!;
    const first = n.first[Math.floor(rng.next() * n.first.length)];
    const last = n.last[Math.floor(rng.next() * n.last.length)];
    const name = `${first} ${last}`;
    if (used.has(name)) continue;
    used.add(name);
    const base = last.replace(/^(de |van |von )/i, "").normalize("NFD").replace(/[^A-Za-z]/g, "").toUpperCase();
    let short = base.slice(0, 3);
    for (let k = 3; shorts.has(short) && k < base.length; k++) short = base.slice(0, 2) + base[k];
    for (let k = 0; shorts.has(short); k++) short = base.slice(0, 2) + String.fromCharCode(65 + k);
    shorts.add(short);
    const age = Math.round(18 + rng.next() * 20);
    const talent = 66 + rng.gauss(11);
    const exp = Math.min(1, (age - 18) / 14); // experiência ajuda feedback e consistência
    const p = {
      id: short.toLowerCase(),
      name,
      short,
      nat: n.nat,
      country: n.country,
      age,
      pace: clamp(talent + rng.gauss(9) - Math.max(0, age - 33) * 1.5),
      consistency: clamp(talent - 6 + exp * 14 + rng.gauss(10)),
      aggression: clamp(55 + rng.gauss(20) - exp * 8),
      tyreCare: clamp(talent - 4 + exp * 8 + rng.gauss(12)),
      wet: clamp(talent + rng.gauss(14)),
      overtaking: clamp(talent + rng.gauss(12)),
      defending: clamp(talent - 3 + exp * 6 + rng.gauss(12)),
      feedback: clamp(45 + exp * 35 + rng.gauss(13)),
      balancePref: Math.round(rng.gauss(7)),
      stiffPref: Math.round(rng.gauss(10)),
    };
    const rating = Math.round(
      p.pace * 0.4 + p.consistency * 0.15 + p.tyreCare * 0.1 + p.wet * 0.1 + p.overtaking * 0.1 + p.defending * 0.1 + p.feedback * 0.05,
    );
    out.push({ ...p, rating, style: styleOf(p) });
  }
  return out;
}

export const DRIVER_POOL: DriverProfile[] = buildPool();
const BY_ID = new Map(DRIVER_POOL.map((d) => [d.id, d]));

export function profileOf(id: string): DriverProfile | undefined {
  return BY_ID.get(id);
}

/** escalação: 2 pilotos por equipe */
export type Lineup = Record<string, [string, string]>;

/** sorteia 20 pilotos da base pras 10 equipes */
export function drawLineup(seed: number): Lineup {
  const rng = new Rng(seed ^ 0x7a11);
  const ids = DRIVER_POOL.map((d) => d.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const out: Lineup = {};
  TEAMS.forEach((t, i) => (out[t.id] = [ids[i * 2], ids[i * 2 + 1]]));
  return out;
}

/** perfil -> piloto usado na simulação */
export function toDriver(p: DriverProfile, teamId: string): Driver {
  return {
    id: p.id,
    name: p.name,
    short: p.short,
    teamId,
    // velocidade 100 = 0 s; 40 = ~0,55 s mais lento por volta
    skill: ((100 - p.pace) / 100) * 0.9,
    // cuidado com pneu 100 = gasta 15% menos; 20 = 9% mais
    tyreCare: 1.15 - (p.tyreCare / 100) * 0.3,
    profile: p,
  };
}

/** reserva (3º piloto) de cada equipe: sorteado entre os que ficaram de fora; segredo até a troca */
export function drawReserves(lineup: Lineup, seed: number): Record<string, string> {
  const rng = new Rng(seed ^ 0x5e5e);
  const used = new Set(Object.values(lineup).flat());
  const free = DRIVER_POOL.map((d) => d.id).filter((id) => !used.has(id));
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  const out: Record<string, string> = {};
  TEAMS.forEach((t, i) => (out[t.id] = free[i]));
  return out;
}
