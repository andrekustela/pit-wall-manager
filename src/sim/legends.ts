// 100 pilotos reais de todas as eras da F1 (opção "Lendas" no lobby).
// As notas são estimativas pela fama de cada um (não são dados oficiais).
// Formato: [nome, sigla, país (ISO), nome do país, idade no auge, nota base, traços]
// Traços ajustam atributos: vel, con, agr, pne, chu, ult, def, fb (+/- pontos),
// e bal/sus = preferência de acerto.
import { Rng } from "./rng";
import type { DriverProfile } from "./drivers";

type Row = [string, string, string, string, number, number, string];

const ROWS: Row[] = [
  ["Ayrton Senna", "SEN", "BR", "Brasil", 31, 95, "vel+3 chu+5 agr+18 ult+3 pne-12 bal+6"],
  ["Lewis Hamilton", "HAM", "GB", "Reino Unido", 33, 95, "chu+3 pne+2 ult+1 agr+2"],
  ["Michael Schumacher", "MSC", "DE", "Alemanha", 31, 95, "chu+3 fb+2 agr+12 def+1 pne-7 sus+8"],
  ["Max Verstappen", "VER", "NL", "Holanda", 27, 95, "vel+3 agr+22 def+3 ult+3 chu+2 pne-6 bal+8"],
  ["Alain Prost", "PRO", "FR", "França", 31, 92, "con+6 pne+7 fb+7 agr-38 chu-14 bal-6"],
  ["Fernando Alonso", "ALO", "ES", "Espanha", 30, 93, "def+5 fb+2 ult+2 agr+6 pne-2"],
  ["Juan Manuel Fangio", "FAN", "AR", "Argentina", 44, 94, "con+3 pne+3 agr-4"],
  ["Jim Clark", "CLA", "GB", "Reino Unido", 29, 94, "vel+3 pne+4 agr-12 con+2"],
  ["Niki Lauda", "LAU", "AT", "Áustria", 28, 90, "fb+9 con+6 pne+6 agr-26 chu-16"],
  ["Jackie Stewart", "STE", "GB", "Reino Unido", 30, 91, "chu+6 con+4 pne+4 agr-24"],
  ["Sebastian Vettel", "VET", "DE", "Alemanha", 26, 90, "def-3 con+2 fb+2 agr+2"],
  ["Mika Häkkinen", "HAK", "FI", "Finlândia", 30, 90, "vel+3 def-2 agr-6 chu-2"],
  ["Kimi Räikkönen", "RAI", "FI", "Finlândia", 28, 89, "vel+2 fb-14 con-2 pne+4 agr-6"],
  ["Nelson Piquet", "PIQ", "BR", "Brasil", 31, 88, "fb+6 pne+4 agr+4"],
  ["Emerson Fittipaldi", "FIT", "BR", "Brasil", 27, 87, "pne+6 con+4 agr-10"],
  ["Nigel Mansell", "MAN", "GB", "Reino Unido", 38, 88, "agr+22 ult+6 pne-8 con-5 chu+2"],
  ["Jack Brabham", "BRA", "AU", "Austrália", 40, 86, "fb+10 pne+4 agr+4"],
  ["Jochen Rindt", "RIN", "AT", "Áustria", 28, 88, "vel+4 agr+16 con-8"],
  ["Graham Hill", "GHI", "GB", "Reino Unido", 33, 84, "con+4 fb+6 agr-6"],
  ["Damon Hill", "DHI", "GB", "Reino Unido", 35, 83, "con+4 agr-8 ult-4"],
  ["Jacques Villeneuve", "JVI", "CA", "Canadá", 26, 83, "agr+12 ult+4 fb-4"],
  ["Jenson Button", "BUT", "GB", "Reino Unido", 29, 84, "pne+12 chu+8 agr-18 vel-2 bal-6"],
  ["Nico Rosberg", "ROS", "DE", "Alemanha", 31, 86, "con+5 fb+6 ult-6 agr-8"],
  ["Keke Rosberg", "KRO", "FI", "Finlândia", 33, 83, "agr+20 vel+2 pne-8"],
  ["Alan Jones", "JON", "AU", "Austrália", 33, 82, "agr+12 def+4"],
  ["James Hunt", "HUN", "GB", "Reino Unido", 29, 84, "agr+20 vel+4 con-10 fb-6"],
  ["Mario Andretti", "MAR", "US", "EUA", 38, 85, "fb+8 ult+3"],
  ["Phil Hill", "PHI", "US", "EUA", 34, 80, "con+4 agr-10"],
  ["John Surtees", "SUR", "GB", "Reino Unido", 30, 82, "fb+8 agr+2"],
  ["Denny Hulme", "HME", "NZ", "Nova Zelândia", 31, 80, "con+6 pne+6 agr-10"],
  ["Alberto Ascari", "ASC", "IT", "Itália", 34, 90, "con+6 vel+2 agr-6"],
  ["Giuseppe Farina", "FAR", "IT", "Itália", 44, 80, "agr+10 con-4"],
  ["Mike Hawthorn", "HAW", "GB", "Reino Unido", 29, 79, "agr+8"],
  ["Jody Scheckter", "SCK", "ZA", "África do Sul", 29, 81, "agr+12 con+2"],
  ["Stirling Moss", "MOS", "GB", "Reino Unido", 29, 91, "chu+4 ult+4 agr+6"],
  ["Gilles Villeneuve", "GVI", "CA", "Canadá", 28, 88, "vel+5 chu+6 agr+28 ult+6 pne-16 con-8 bal+10"],
  ["Rubens Barrichello", "BAR", "BR", "Brasil", 30, 82, "chu+6 fb+6 con+3 agr-6"],
  ["Felipe Massa", "MAS", "BR", "Brasil", 27, 81, "vel+2 chu-6 agr+2"],
  ["David Coulthard", "COU", "GB", "Reino Unido", 30, 80, "con+4 agr-8"],
  ["Mark Webber", "WEB", "AU", "Austrália", 34, 80, "def+6 agr+8 pne-2"],
  ["Charles Leclerc", "LEC", "MC", "Mônaco", 26, 89, "vel+5 con-4 pne-4 agr+6"],
  ["Lando Norris", "NOR", "GB", "Reino Unido", 25, 88, "vel+3 def-6 agr-4"],
  ["Carlos Sainz", "SAI", "ES", "Espanha", 29, 85, "pne+6 con+4 fb+4 agr-2"],
  ["George Russell", "RUS", "GB", "Reino Unido", 26, 86, "vel+3 con+2 def+2"],
  ["Sergio Pérez", "PER", "MX", "México", 32, 80, "pne+14 ult+6 vel-6 agr+2"],
  ["Valtteri Bottas", "BOT", "FI", "Finlândia", 30, 81, "vel+3 ult-6 def-4 agr-12"],
  ["Daniel Ricciardo", "RIC", "AU", "Austrália", 28, 84, "ult+12 agr+10 con-3"],
  ["Oscar Piastri", "PIA", "AU", "Austrália", 23, 86, "con+6 agr-6 pne+4"],
  ["Pierre Gasly", "GAS", "FR", "França", 27, 80, "agr+2"],
  ["Esteban Ocon", "OCO", "FR", "França", 26, 79, "def+8 agr+6"],
  ["Lance Stroll", "STR", "CA", "Canadá", 26, 73, "chu+6 con-6"],
  ["Yuki Tsunoda", "TSU", "JP", "Japão", 24, 78, "agr+14 con-6 vel+2"],
  ["Alexander Albon", "ALB", "TH", "Tailândia", 27, 80, "pne+6 def+4"],
  ["Nico Hülkenberg", "HUL", "DE", "Alemanha", 34, 79, "con+4 fb+6 ult-4"],
  ["Kevin Magnussen", "MAG", "DK", "Dinamarca", 30, 76, "agr+20 def+8 pne-6"],
  ["Romain Grosjean", "GRO", "FR", "França", 30, 76, "vel+4 con-10 agr+8"],
  ["Robert Kubica", "KUB", "PL", "Polônia", 24, 84, "chu+8 fb+4"],
  ["Juan Pablo Montoya", "MON", "CO", "Colômbia", 27, 85, "agr+22 ult+10 pne-8 con-6"],
  ["Ralf Schumacher", "RSC", "DE", "Alemanha", 27, 79, "agr+2"],
  ["Eddie Irvine", "IRV", "GB", "Reino Unido", 33, 77, "agr+8"],
  ["Gerhard Berger", "BER", "AT", "Áustria", 30, 82, "agr+6 fb+2"],
  ["Jean Alesi", "ALE", "FR", "França", 26, 82, "chu+8 agr+16 pne-6"],
  ["Riccardo Patrese", "PAT", "IT", "Itália", 38, 79, "con+4 fb+4"],
  ["Michele Alboreto", "ALR", "IT", "Itália", 28, 79, "con+2"],
  ["Ronnie Peterson", "PET", "SE", "Suécia", 29, 87, "vel+6 agr+14 pne-8 fb-6"],
  ["Carlos Reutemann", "REU", "AR", "Argentina", 33, 82, "vel+3 con-4 agr-4"],
  ["Clay Regazzoni", "REG", "CH", "Suíça", 35, 79, "agr+14 def+4"],
  ["Jacky Ickx", "ICK", "BE", "Bélgica", 26, 84, "chu+12 agr+2"],
  ["Didier Pironi", "PIR", "FR", "França", 30, 82, "vel+3 agr+8"],
  ["René Arnoux", "ARN", "FR", "França", 34, 81, "agr+14 vel+2 con-4"],
  ["Elio de Angelis", "ANG", "IT", "Itália", 26, 79, "pne+4"],
  ["Thierry Boutsen", "BOU", "BE", "Bélgica", 32, 77, "chu+6 con+2"],
  ["Heinz-Harald Frentzen", "FRE", "DE", "Alemanha", 32, 79, "vel+2"],
  ["Giancarlo Fisichella", "FIS", "IT", "Itália", 32, 77, ""],
  ["Jarno Trulli", "TRU", "IT", "Itália", 30, 78, "vel+6 ult-8 def+8"],
  ["Takuma Sato", "SAT", "JP", "Japão", 27, 73, "agr+18 con-6"],
  ["Kamui Kobayashi", "KOB", "JP", "Japão", 26, 74, "agr+18 ult+10 pne-4"],
  ["Pastor Maldonado", "MAL", "VE", "Venezuela", 27, 71, "vel+6 agr+26 con-14"],
  ["Paul di Resta", "DIR", "GB", "Reino Unido", 26, 72, "pne+4"],
  ["Esteban Gutiérrez", "GUT", "MX", "México", 23, 66, ""],
  ["Daniil Kvyat", "KVY", "RU", "Rússia", 25, 73, "agr+10"],
  ["Jean-Éric Vergne", "VRG", "FR", "França", 24, 74, "con+2"],
  ["Stoffel Vandoorne", "VAN", "BE", "Bélgica", 25, 72, "fb+6"],
  ["Antonio Giovinazzi", "GIO", "IT", "Itália", 27, 70, ""],
  ["Mick Schumacher", "MSH", "DE", "Alemanha", 23, 69, "con+2"],
  ["Nyck de Vries", "DEV", "NL", "Holanda", 28, 67, ""],
  ["Logan Sargeant", "SAR", "US", "EUA", 22, 62, "con-6"],
  ["Zhou Guanyu", "ZHO", "CN", "China", 24, 70, "pne+4"],
  ["Franco Colapinto", "COL", "AR", "Argentina", 21, 70, "agr+10 con-4"],
  ["Oliver Bearman", "BEA", "GB", "Reino Unido", 19, 74, "agr+6 ult+4"],
  ["Kimi Antonelli", "ANT", "IT", "Itália", 19, 78, "vel+4 con-6"],
  ["Gabriel Bortoleto", "BOR", "BR", "Brasil", 20, 75, "con+4 pne+2"],
  ["Isack Hadjar", "HAD", "FR", "França", 20, 75, "vel+2 agr+6"],
  ["Liam Lawson", "LAW", "NZ", "Nova Zelândia", 22, 74, "agr+12 def+4"],
  ["Heikki Kovalainen", "KOV", "FI", "Finlândia", 27, 73, ""],
  ["Mika Salo", "SAL", "FI", "Finlândia", 33, 71, ""],
  ["Johnny Herbert", "HER", "GB", "Reino Unido", 31, 74, "chu+4"],
  ["Martin Brundle", "BRU", "GB", "Reino Unido", 33, 74, "fb+10"],
  ["Pedro de la Rosa", "ROA", "ES", "Espanha", 34, 70, "fb+12"],
  ["Felipe Nasr", "NAS", "BR", "Brasil", 23, 70, "chu+4"],
];

const KEY: Record<string, keyof DriverProfile> = {
  vel: "pace", con: "consistency", agr: "aggression", pne: "tyreCare", chu: "wet", ult: "overtaking", def: "defending", fb: "feedback",
};

const flag = (code: string) => String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
const clamp = (x: number) => Math.round(Math.max(20, Math.min(99, x)));

export function buildLegends(styleOf: (p: Omit<DriverProfile, "style" | "rating">) => string): DriverProfile[] {
  const rng = new Rng(19500513); // primeira corrida da F1
  return ROWS.map(([name, short, code, country, age, base, traits]) => {
    const mods: Record<string, number> = {};
    for (const t of traits.split(" ").filter(Boolean)) {
      const m = t.match(/^([a-z]+)([+-]\d+)$/);
      if (m) mods[m[1]] = Number(m[2]);
    }
    const n = () => rng.gauss(2.5);
    const p = {
      id: `r_${short.toLowerCase()}`,
      name,
      short,
      nat: flag(code),
      country,
      age,
      pace: clamp(base + 1 + (mods.vel ?? 0) + n()),
      consistency: clamp(base - 2 + (mods.con ?? 0) + n()),
      aggression: clamp(55 + (mods.agr ?? 0) + n() * 2),
      tyreCare: clamp(base - 4 + (mods.pne ?? 0) + n()),
      wet: clamp(base - 3 + (mods.chu ?? 0) + n()),
      overtaking: clamp(base - 2 + (mods.ult ?? 0) + n()),
      defending: clamp(base - 3 + (mods.def ?? 0) + n()),
      feedback: clamp(base - 5 + (mods.fb ?? 0) + n()),
      balancePref: mods.bal ?? Math.round(rng.gauss(5)),
      stiffPref: mods.sus ?? Math.round(rng.gauss(8)),
    } satisfies Omit<DriverProfile, "style" | "rating">;
    void KEY;
    const rating = Math.round(
      p.pace * 0.4 + p.consistency * 0.15 + p.tyreCare * 0.1 + p.wet * 0.1 + p.overtaking * 0.1 + p.defending * 0.1 + p.feedback * 0.05,
    );
    return { ...p, rating, style: styleOf(p) };
  });
}
