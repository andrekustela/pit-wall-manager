# Gera o carro de F1 do Pit Wall Manager no Blender (rode dentro do Blender).
# Medidas em metros, frente do carro pra +X, chão em Z=0, lado esquerdo +Y.
# Tamanho de F1 de verdade: ~5,6 m x 2,0 m; eixos nas mesmas posições do
# desenho do jogo (traseiro x=-2,05, dianteiro x=1,79).
import bpy, bmesh, math
from mathutils import Vector

# ---------- limpeza ----------
CENARIO = {"Chao", "Sol", "Camera"}  # o cenário da prévia fica
for o in list(bpy.data.objects):
    if o.name not in CENARIO:
        bpy.data.objects.remove(o, do_unlink=True)
for coll in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.lights, bpy.data.cameras):
    for d in list(coll):
        if d.users == 0:
            coll.remove(d)
SC = bpy.context.scene
COL = SC.collection

# ---------- materiais ----------
def mat(name, color, rough=0.5, metal=0.0, coat=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    for k in ("Coat Weight", "Clearcoat"):
        if k in b.inputs:
            b.inputs[k].default_value = coat
    return m

M = {
    "pintura": mat("Pintura", (0.80, 0.80, 0.80), 0.25, 0.0, 0.7),
    "asa": mat("Asa", (0.80, 0.80, 0.80), 0.3, 0.0, 0.5),
    "carbono": mat("Carbono", (0.018, 0.019, 0.022), 0.5, 0.0, 0.15),
    "borracha": mat("Borracha", (0.022, 0.022, 0.024), 0.8),
    "aro": mat("Aro", (0.06, 0.06, 0.065), 0.35, 0.85),
    "faixa_pneu": mat("FaixaPneu", (0.95, 0.78, 0.05), 0.6),
    "capacete": mat("Capacete", (0.96, 0.80, 0.10), 0.22, 0.0, 0.9),
    "viseira": mat("Viseira", (0.01, 0.01, 0.012), 0.05, 0.6),
    "titanio": mat("Titanio", (0.12, 0.12, 0.13), 0.3, 0.9),
    "luz": mat("LuzChuva", (0.30, 0.02, 0.02), 0.4),
}

def obj_from_bm(name, bm, mats, smooth=True, subsurf=0):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    COL.objects.link(o)
    for m in mats:
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = smooth
    if subsurf:
        s = o.modifiers.new("lisura", "SUBSURF")
        s.levels = subsurf
        s.render_levels = subsurf
    return o

# ---------- loft: une seções (laços de pontos) numa superfície fechada ----------
def section(x, yc, zc, a, b, n=2.6, N=36, zmin=None):
    """superelipse no plano YZ: a = meia-largura, b = meia-altura, n = 'quadradice'"""
    pts = []
    for i in range(N):
        t = 2 * math.pi * i / N
        c, s = math.cos(t), math.sin(t)
        y = yc + a * math.copysign(abs(c) ** (2 / n), c)
        z = zc + b * math.copysign(abs(s) ** (2 / n), s)
        if zmin is not None:
            z = max(z, zmin)
        pts.append((x, y, z))
    return pts

def _shrink(sec, k, dx=0.0):
    cy = sum(p[1] for p in sec) / len(sec)
    cz = sum(p[2] for p in sec) / len(sec)
    return [(p[0] + dx, cy + (p[1] - cy) * k, cz + (p[2] - cz) * k) for p in sec]

def loft(name, secs, mats, cap_mats=(0, 0), subsurf=2, mouth=None):
    """mouth=(escala, profundidade): a frente vira uma boca de ar (borda + cavidade escura)"""
    secs = list(secs)
    pre = []
    if mouth:
        k, depth = mouth
        s0 = secs[0]
        # cavidade (escura) -> borda interna -> borda externa (com laço de apoio pra suavização ficar firme)
        pre = [_shrink(s0, k, -depth), _shrink(s0, k, -0.004), _shrink(s0, (1 + k) / 2, 0.002)]
        secs = pre + [_shrink(s0, 0.985, 0.0)] + secs[1:]
    bm = bmesh.new()
    rings = [[bm.verts.new(p) for p in s] for s in secs]
    N = len(secs[0])
    for j, (r0, r1) in enumerate(zip(rings, rings[1:])):
        for i in range(N):
            f = bm.faces.new((r0[i], r0[(i + 1) % N], r1[(i + 1) % N], r1[i]))
            if mouth and j == 0:
                f.material_index = 1  # paredes da cavidade
    f0 = bm.faces.new(rings[0][::-1])
    f1 = bm.faces.new(rings[-1])
    f0.material_index, f1.material_index = (1 if mouth else cap_mats[0]), cap_mats[1]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    o = obj_from_bm(name, bm, mats, True, subsurf)
    return o

# ---------- chassi: bico + cockpit + capa do motor ----------
CH = [  # x, zc, meia-largura, meia-altura, n
    (2.56, 0.195, 0.012, 0.010, 2.0),  # ponta do bico (pequena, pra tampa não deformar)
    (2.52, 0.20, 0.050, 0.045, 2.2),
    (2.35, 0.21, 0.080, 0.065, 2.4),
    (2.05, 0.25, 0.105, 0.090, 2.6),
    (1.65, 0.31, 0.145, 0.130, 2.8),
    (1.25, 0.38, 0.200, 0.180, 3.0),
    (0.95, 0.43, 0.245, 0.200, 3.2),
    (0.60, 0.45, 0.265, 0.200, 3.4),
    (0.32, 0.48, 0.265, 0.230, 3.4),
    (0.12, 0.56, 0.230, 0.370, 3.0),  # tomada de ar (airbox) — topo ~0,93 m
    (-0.25, 0.53, 0.200, 0.320, 2.8),
    (-0.90, 0.46, 0.165, 0.230, 2.6),
    (-1.60, 0.39, 0.130, 0.160, 2.6),
    (-2.20, 0.34, 0.100, 0.110, 2.6),
    (-2.45, 0.33, 0.070, 0.075, 2.4),
    (-2.48, 0.33, 0.015, 0.015, 2.0),
]
chassi = loft("Chassi", [section(x, 0, zc, a, b, n) for x, zc, a, b, n in CH], [M["pintura"], M["carbono"]], (1, 1))

# abertura do cockpit (corte) + fundo escuro por dentro
def ellipsoid(name, loc, size, m, seg=32):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0] + loc[0], v.co.y * size[1] + loc[1], v.co.z * size[2] + loc[2]))
    return obj_from_bm(name, bm, [m])

corte = ellipsoid("CorteCockpit", (0.66, 0, 0.70), (0.40, 0.19, 0.17), M["carbono"])
bo = chassi.modifiers.new("cockpit", "BOOLEAN")
bo.object = corte
bo.operation = "DIFFERENCE"
bo.solver = "EXACT"
# o corte vem DEPOIS da suavização (antes, a suavização deformava a borda)
corte.hide_render = True
corte.hide_viewport = True
ellipsoid("InteriorCockpit", (0.66, 0, 0.52), (0.38, 0.18, 0.08), M["carbono"])
# moldura do cockpit (acabamento escuro em volta da abertura)
cu = bpy.data.curves.new("MolduraCurva", "CURVE")
cu.dimensions = "3D"
cu.bevel_depth = 0.018
cu.bevel_resolution = 3
sp = cu.splines.new("NURBS")
MP = []
for i in range(24):
    t = 2 * math.pi * i / 24
    x = 0.66 + 0.385 * math.cos(t)
    y = 0.185 * math.sin(t)
    # altura da superfície do chassi nesse ponto (aprox.): mais alto atrás (encosto)
    z = 0.635 + 0.02 * (0.66 - x) / 0.385
    MP.append((x, y, z))
sp.points.add(len(MP) - 1)
for p, c in zip(sp.points, MP):
    p.co = (*c, 1)
sp.use_cyclic_u = True
sp.order_u = 4
mold = bpy.data.objects.new("MolduraCockpit", cu)
COL.objects.link(mold)
cu.materials.append(M["carbono"])

# barbatana (shark fin) da capa do motor até a asa traseira
def plate(name, outline_xz, y, thick, m):
    bm = bmesh.new()
    vs0 = [bm.verts.new((x, y - thick / 2, z)) for x, z in outline_xz]
    vs1 = [bm.verts.new((x, y + thick / 2, z)) for x, z in outline_xz]
    bm.faces.new(vs0[::-1])
    bm.faces.new(vs1)
    n = len(vs0)
    for i in range(n):
        bm.faces.new((vs0[i], vs0[(i + 1) % n], vs1[(i + 1) % n], vs1[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return obj_from_bm(name, bm, [m], smooth=False)


# ---------- laterais (sidepods), com boca de ar escura na frente ----------
for s in (-1, 1):
    SP = [  # x, yc, zc, a, b, n
        (0.62, 0.43, 0.40, 0.17, 0.13, 5.0),
        (0.45, 0.45, 0.40, 0.20, 0.15, 5.0),
        (-0.15, 0.43, 0.38, 0.21, 0.16, 4.6),
        (-0.75, 0.35, 0.33, 0.18, 0.13, 4.0),
        (-1.35, 0.25, 0.28, 0.13, 0.10, 3.4),
        (-1.80, 0.17, 0.25, 0.07, 0.07, 2.8),
    ]
    SP.append((-1.86, 0.15, 0.25, 0.015, 0.015, 2.0))  # ponta fina atrás (tampa sem deformar)
    loft(f"Lateral{s}", [section(x, yc * s, zc, a, b, n) for x, yc, zc, a, b, n in SP], [M["pintura"], M["carbono"]], (1, 0), mouth=(0.78, 0.14))

# ---------- assoalho ----------
bm = bmesh.new()
FL = [(1.05, 0.28), (0.75, 0.62), (0.40, 0.73), (-1.45, 0.73), (-1.72, 0.56), (-2.35, 0.52)]
outline = FL + [(x, -y) for x, y in reversed(FL)]
bot = [bm.verts.new((x, y, 0.03)) for x, y in outline]
top = [bm.verts.new((x, y, 0.06)) for x, y in outline]
bm.faces.new(bot[::-1])
bm.faces.new(top)
n = len(bot)
for i in range(n):
    bm.faces.new((bot[i], bot[(i + 1) % n], top[(i + 1) % n], top[i]))
fl = obj_from_bm("Assoalho", bm, [M["carbono"]], smooth=False)
bv = fl.modifiers.new("borda", "BEVEL")
bv.width = 0.012
bv.segments = 2

# ---------- rodas: pneu de perfil baixo + aro de 18" com calota + faixa do composto ----------
def lathe(name, profile, center, m, seg=64, smooth=True):
    """gira um perfil (raio, deslocamento no eixo Y) em volta do eixo Y"""
    bm = bmesh.new()
    rings = []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        rings.append([bm.verts.new((center[0] + r * math.cos(a), center[1] + w, center[2] + r * math.sin(a))) for r, w in profile])
    P = len(profile)
    for k in range(seg):
        r0, r1 = rings[k], rings[(k + 1) % seg]
        for i in range(P - 1):
            bm.faces.new((r0[i], r1[i], r1[i + 1], r0[i + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return obj_from_bm(name, bm, [m], smooth)

def wheel(tag, x, y, width, R=0.36, rim=0.235):
    c = (x, y, R)
    h = width / 2
    # perfil do pneu: banda de rodagem reta, laterais arredondadas
    prof = []
    for i in range(9):
        a = math.pi / 2 * i / 8
        prof.append((rim + (R - rim - 0.045) + 0.045 * math.cos(math.pi / 2 - a), -h + 0.045 * (1 - math.sin(math.pi / 2 - a))))
    prof = [(rim, -h + 0.03)] + prof
    prof += [(r, -w) for r, w in reversed(prof)]
    lathe(f"Pneu{tag}", prof, c, M["borracha"])
    # aro e calota (lado de fora)
    out = 1 if y > 0 else -1
    lathe(f"Aro{tag}", [(0.0, out * (h - 0.02)), (rim * 0.7, out * (h - 0.03)), (rim, out * (h - 0.05)), (rim, -out * (h - 0.05))], c, M["aro"])
    # faixa colorida do composto na lateral do pneu
    lathe(f"Faixa{tag}", [(rim + 0.035, out * (h + 0.002)), (rim + 0.05, out * (h + 0.002))], c, M["faixa_pneu"], smooth=False)

for s in (-1, 1):
    wheel(f"T{s}", -2.05, 0.80 * s, 0.40)
    wheel(f"D{s}", 1.79, 0.81 * s, 0.31)

# ---------- suspensão ----------
def rod(name, a, b, r=0.018, m=None):
    a, b = Vector(a), Vector(b)
    d = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=r, radius2=r, depth=d.length)
    q = d.to_track_quat("Z", "Y")
    for v in bm.verts:
        v.co = q @ v.co + (a + b) / 2
    return obj_from_bm(name, bm, [m or M["carbono"]])

for s in (-1, 1):
    # dianteira: dois triângulos + barra de empurrar (pushrod)
    for zc, zw in ((0.40, 0.45), (0.22, 0.20)):
        rod(f"SuspDA{s}{zc}", (1.55, 0.12 * s, zc), (1.79, 0.64 * s, zw))
        rod(f"SuspDB{s}{zc}", (2.05, 0.10 * s, zc - 0.02), (1.79, 0.64 * s, zw))
    rod(f"PushD{s}", (1.80, 0.62 * s, 0.22), (1.62, 0.15 * s, 0.50), 0.015)
    # traseira
    for zc, zw in ((0.36, 0.45), (0.20, 0.20)):
        rod(f"SuspTA{s}{zc}", (-1.80, 0.14 * s, zc), (-2.05, 0.58 * s, zw))
        rod(f"SuspTB{s}{zc}", (-2.30, 0.12 * s, zc), (-2.05, 0.58 * s, zw))

# ---------- asa dianteira ----------
def wing_blade(name, x_le, chord, z0, span, rise, m, thick=0.018, sweep=0.0):
    """lâmina fina: sobe (rise) nas pontas; sweep puxa as pontas pra trás"""
    bm = bmesh.new()
    N = 48
    rows = []
    for i in range(N + 1):
        y = -span + 2 * span * i / N
        u = abs(y) / span
        z = z0 + rise * u ** 2.2
        x = x_le - sweep * u ** 2
        rows.append([bm.verts.new((x + dx, y, z + dz)) for dx, dz in ((0, 0), (-chord, thick * 0.3), (-chord, thick), (0, thick * 0.8))])
    for r0, r1 in zip(rows, rows[1:]):
        for k in range(4):
            bm.faces.new((r0[k], r1[k], r1[(k + 1) % 4], r0[(k + 1) % 4]))
    bm.faces.new(rows[0][::-1])
    bm.faces.new(rows[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return obj_from_bm(name, bm, [m])

wing_blade("AsaDiantPlano", 2.74, 0.30, 0.06, 0.96, 0.05, M["asa"], 0.02, 0.05)
wing_blade("AsaDiantFlap1", 2.50, 0.13, 0.10, 0.94, 0.10, M["asa"], 0.016, 0.06)
wing_blade("AsaDiantFlap2", 2.40, 0.11, 0.15, 0.92, 0.12, M["asa"], 0.014, 0.06)
for s in (-1, 1):
    plate(f"PlacaDiant{s}", [(2.78, 0.03), (2.78, 0.20), (2.55, 0.30), (2.30, 0.30), (2.30, 0.03)], 0.975 * s, 0.018, M["carbono"])
    plate(f"SuporteBico{s}", [(2.48, 0.08), (2.48, 0.19), (2.30, 0.20), (2.30, 0.08)], 0.045 * s, 0.014, M["carbono"])

# ---------- asa traseira (alta, acima dos pneus) ----------
def rear_blade(name, x_le, chord, z, half, m, thick=0.022, tilt=0.0):
    bm = bmesh.new()
    pts = [(0, 0), (-chord, tilt), (-chord, tilt + thick), (0, thick * 0.7)]
    a = [bm.verts.new((x_le + dx, -half, z + dz)) for dx, dz in pts]
    b = [bm.verts.new((x_le + dx, half, z + dz)) for dx, dz in pts]
    bm.faces.new(a[::-1])
    bm.faces.new(b)
    for k in range(4):
        bm.faces.new((a[k], b[k], b[(k + 1) % 4], a[(k + 1) % 4]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return obj_from_bm(name, bm, [m], smooth=False)

rear_blade("AsaTrasPlano", -2.55, 0.27, 0.80, 0.49, M["asa"], 0.025, 0.04)
rear_blade("AsaTrasFlap", -2.50, 0.17, 0.89, 0.49, M["asa"], 0.02, 0.07)
rear_blade("AsaTrasViga", -2.48, 0.18, 0.40, 0.42, M["carbono"], 0.02, 0.02)
for s in (-1, 1):
    plate(f"PlacaTras{s}", [(-2.42, 0.97), (-2.86, 0.97), (-2.86, 0.38), (-2.70, 0.32), (-2.42, 0.36)], 0.505 * s, 0.02, M["carbono"])
# pilar central (pescoço de cisne) e estrutura traseira com a luz de chuva
plate("PilarAsa", [(-2.52, 0.86), (-2.62, 0.86), (-2.55, 0.36), (-2.42, 0.34)], 0, 0.035, M["carbono"])
loft("EstruturaTras", [section(x, 0, 0.30, 0.07, 0.06, 2.4, 16) for x in (-2.42, -2.70, -2.86)], [M["carbono"]], (0, 0), subsurf=1)
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1.0)
for v in bm.verts:
    v.co = Vector((v.co.x * 0.03 - 2.875, v.co.y * 0.12, v.co.z * 0.06 + 0.30))
obj_from_bm("LuzChuva", bm, [M["luz"]], smooth=False)
# difusor
plate("Difusor", [(-2.30, 0.06), (-2.62, 0.20), (-2.62, 0.06)], 0, 1.0, M["carbono"])

# ---------- halo (titânio): preso atrás dos dois lados + pilar central na frente ----------
cu = bpy.data.curves.new("HaloCurva", "CURVE")
cu.dimensions = "3D"
cu.bevel_depth = 0.026
cu.bevel_resolution = 4
sp = cu.splines.new("NURBS")
HP = [(0.34, -0.25, 0.60), (0.38, -0.25, 0.74), (0.62, -0.23, 0.80), (0.90, -0.12, 0.80), (1.00, 0.0, 0.79),
      (0.90, 0.12, 0.80), (0.62, 0.23, 0.80), (0.38, 0.25, 0.74), (0.34, 0.25, 0.60)]
sp.points.add(len(HP) - 1)
for p, c in zip(sp.points, HP):
    p.co = (*c, 1)
sp.use_endpoint_u = True
sp.order_u = 4
halo = bpy.data.objects.new("Halo", cu)
COL.objects.link(halo)
cu.materials.append(M["titanio"])
rod("HaloPilar", (1.00, 0, 0.79), (1.10, 0, 0.58), 0.03, M["titanio"])

# ---------- piloto: capacete com viseira ----------
ellipsoid("Capacete", (0.60, 0, 0.67), (0.135, 0.12, 0.13), M["capacete"])
ellipsoid("Viseira", (0.66, 0, 0.685), (0.085, 0.105, 0.045), M["viseira"])

# ---------- espelhos (no alto das laterais, perto do cockpit) ----------
for s in (-1, 1):
    # haste sai da lateral do chassi; carcaça pintada com o espelho escuro virado pra trás
    rod(f"EspHaste{s}", (0.90, 0.20 * s, 0.55), (0.90, 0.37 * s, 0.645), 0.013)
    ellipsoid(f"Espelho{s}", (0.90, 0.43 * s, 0.65), (0.04, 0.075, 0.035), M["pintura"], 20)
    ellipsoid(f"EspVidro{s}", (0.87, 0.43 * s, 0.65), (0.012, 0.065, 0.028), M["viseira"], 16)

print("carro gerado:", len([o for o in bpy.data.objects]), "objetos")
