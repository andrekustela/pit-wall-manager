// Safety car do jogo, desenho próprio (o modelo antigo veio de um jogo comercial e não pode ir num jogo
// publicado): esportivo baixo genérico, prata com faixa verde e amarela, vidros escuros, barra de luzes no
// teto (giroflex_e / giroflex_d, o jogo acende e apaga) e as quatro rodas soltas (roda_*, giram).
// Em metros, frente pra +Z, centro no meio e no chão (igual aos outros objetos do jogo).
import * as THREE from "three";

const lam = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.25, ...extra });

/** perfil de lado (z pra frente, y pra cima) extrudado na largura (x), com as quinas arredondadas */
function side(pts: [number, number][], width: number, bevel = 0.06) {
  const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: width - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  // (a forma foi desenhada em z/y: gira pra o comprimento ficar em z e a largura em x)
  g.rotateY(-Math.PI / 2);
  g.translate((width - 2 * bevel) / 2, 0, 0);
  return g;
}

/** textura da lateral: "SAFETY CAR" e as faixas */
function sideTex() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#c9ced4";
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = "#18b04f";
  g.fillRect(0, 84, 512, 16);
  g.fillStyle = "#f6d21a";
  g.fillRect(0, 100, 512, 10);
  g.fillStyle = "#1d2129";
  g.font = "italic 900 44px 'Titillium Web', sans-serif";
  g.textAlign = "center";
  g.fillText("SAFETY CAR", 256, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildSafetyCar(): THREE.Group {
  const root = new THREE.Group();
  const paint = lam("#c9ced4", { metalness: 0.3, roughness: 0.4 });
  const glass = lam("#141a22", { metalness: 0.5, roughness: 0.15 });
  const dark = lam("#1d2129", { metalness: 0.1, roughness: 0.7 });
  // carroceria até a linha da cintura
  const body = new THREE.Mesh(
    side([[2.3, 0.22], [2.32, 0.5], [2.1, 0.66], [1.0, 0.82], [0.6, 0.86], [-1.5, 0.88], [-2.15, 0.84], [-2.3, 0.6], [-2.28, 0.22], [1.95, 0.22]], 1.94),
    paint,
  );
  root.add(body);
  // cabine (vidro) mais estreita, por cima
  const cabin = new THREE.Mesh(side([[0.85, 0.84], [0.25, 1.2], [-0.75, 1.22], [-1.55, 0.9], [-1.5, 0.84]], 1.62, 0.08), glass);
  root.add(cabin);
  // laterais com a escrita (planos colados nos dois lados)
  const tex = sideTex();
  for (const sx of [1, -1]) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 0.5), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2 }));
    pl.rotation.y = (sx * Math.PI) / 2;
    pl.position.set(sx * 0.975, 0.55, -0.05);
    // (do lado direito a escrita leria espelhada: vira)
    if (sx < 0) pl.scale.x = -1;
    root.add(pl);
  }
  // faixa no capô e saia escura embaixo
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 1.25), lam("#18b04f"));
  stripe.position.set(0, 0.8, 1.55);
  stripe.rotation.x = 0.13;
  root.add(stripe);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 4.4), dark);
  skirt.position.set(0, 0.2, 0);
  root.add(skirt);
  // faróis e lanternas
  for (const sx of [1, -1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.05), lam("#ffffff", { emissive: "#dfe8ff", emissiveIntensity: 0.6 }));
    hl.position.set(sx * 0.62, 0.6, 2.3);
    root.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 0.05), lam("#d61f1f", { emissive: "#a00000", emissiveIntensity: 0.6 }));
    tl.position.set(sx * 0.6, 0.72, -2.31);
    root.add(tl);
  }
  // barra de luzes no teto: os dois giroflex (o jogo pinta o material de cada um)
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.07, 0.24), dark);
  bar.position.set(0, 1.27, -0.25);
  root.add(bar);
  for (const [nm, sx] of [["giroflex_e", 1], ["giroflex_d", -1]] as const) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.2), lam("#ff9a1a", { roughness: 0.3, metalness: 0 }));
    l.name = nm;
    l.position.set(sx * 0.3, 1.33, -0.25);
    root.add(l);
  }
  // rodas: pneu, aro claro e tracinhos (pra ver girando); o grupo de cada uma gira em volta do eixo (x)
  const tyre = lam("#141414", { roughness: 0.85, metalness: 0 }), rim = lam("#d8dce0", { metalness: 0.6, roughness: 0.3 });
  for (const [nm, sx, sz] of [["roda_fe", 1, 1.42], ["roda_fd", -1, 1.42], ["roda_te", 1, -1.4], ["roda_td", -1, -1.4]] as const) {
    const w = new THREE.Group();
    w.name = nm;
    w.position.set(sx * 0.84, 0.34, sz);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 18).rotateZ(Math.PI / 2), tyre);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.27, 10).rotateZ(Math.PI / 2), rim);
    w.add(t, r);
    // raios do aro (giram junto e mostram a roda rodando)
    for (let k = 0; k < 5; k++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.05), dark);
      sp.position.x = sx * 0.01;
      sp.rotation.x = (k * 2 * Math.PI) / 5;
      sp.geometry.translate(0, 0.1, 0);
      w.add(sp);
    }
    root.add(w);
  }
  return root;
}
