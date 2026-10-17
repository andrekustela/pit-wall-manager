import type { Driver, Team } from "./types";

// Tudo fictício.
export const TEAMS: Team[] = [
  { id: "vor", name: "Vortex Racing", short: "VOR", color: "#e8202a", accent: "#ffffff", carPace: 0.0 },
  { id: "aur", name: "Aurora GP", short: "AUR", color: "#16c2b0", accent: "#0b2b3a", carPace: 0.15 },
  { id: "zen", name: "Zenith Motorsport", short: "ZEN", color: "#1c2f6e", accent: "#f2c230", carPace: 0.3 },
  { id: "tit", name: "Titan Racing", short: "TIT", color: "#ff8a1c", accent: "#1a1a1a", carPace: 0.5 },
  { id: "fal", name: "Falcão F1", short: "FAL", color: "#1f9d3a", accent: "#ffe03b", carPace: 0.65 },
  { id: "neb", name: "Nebula Team", short: "NEB", color: "#7b3fe4", accent: "#e9e1ff", carPace: 0.8 },
  { id: "pol", name: "Polar Racing", short: "POL", color: "#8fd3ff", accent: "#ffffff", carPace: 0.95 },
  { id: "bra", name: "Brasa Motorsport", short: "BRA", color: "#8c1414", accent: "#111111", carPace: 1.1 },
  { id: "kes", name: "Kestrel GP", short: "KES", color: "#ff5fae", accent: "#2a2a2a", carPace: 1.3 },
  { id: "iro", name: "Ironclad", short: "IRO", color: "#8a8f98", accent: "#e8202a", carPace: 1.5 },
];

const raw: [string, string, string, number, number][] = [
  ["Rafael Moretti", "MOR", "vor", 0.0, 0.92],
  ["Oskar Lindqvist", "LIN", "vor", 0.25, 1.0],
  ["Kenji Arai", "ARA", "aur", 0.1, 0.95],
  ["Lucas Brandão", "BRN", "aur", 0.3, 1.05],
  ["Henri Dubois", "DUB", "zen", 0.05, 1.0],
  ["Mateo Ríos", "RIO", "zen", 0.35, 0.9],
  ["Finn Callahan", "CAL", "tit", 0.15, 1.08],
  ["Tomás Vieira", "VIE", "tit", 0.3, 0.97],
  ["Diego Navarro", "NAV", "fal", 0.2, 1.0],
  ["Ilya Volkov", "VOL", "fal", 0.4, 1.1],
  ["Amara Okafor", "OKA", "neb", 0.15, 0.93],
  ["Theo Lambert", "LAM", "neb", 0.45, 1.02],
  ["Sven Halvorsen", "HAL", "pol", 0.25, 0.98],
  ["Bruno Calixto", "CLX", "pol", 0.4, 1.05],
  ["Marco Bellandi", "BEL", "bra", 0.2, 1.0],
  ["Yuto Mori", "YMO", "bra", 0.5, 0.95],
  ["Nico Hartmann", "HAR", "kes", 0.3, 1.1],
  ["Leo Santana", "SAN", "kes", 0.45, 0.92],
  ["Pablo Herrera", "HER", "iro", 0.35, 1.0],
  ["Arjun Mehta", "MEH", "iro", 0.55, 1.05],
];

export const DRIVERS: Driver[] = raw.map(([name, short, teamId, skill, tyreCare]) => ({
  id: short.toLowerCase(),
  name,
  short,
  teamId,
  skill,
  tyreCare,
}));
