# Carro 3D de verdade (Three.js) pra corrida: public/car3d/carro.glb
# uso: blender -b --factory-startup --disable-autoexec <fp04rb_new_rig.blend> --python art/export_carro_glb.py
# depois comprimir: npx @gltf-transform/cli@4.1.1 meshopt public/car3d/carro.glb public/car3d/carro.glb
# Peças separadas (o jogo esconde/gira cada uma): corpo, asa_d, asa_t e as 4 rodas (com o centro no eixo).
# Materiais com nome fixo pro jogo pintar: pintura (cor da equipe), asa (cor da asa), capacete; o resto vira
# cor lisa (sem textura) e a malha é simplificada pra 20 carros rodarem leve.
import bpy, math, os
from mathutils import Vector

# PWM_HD=1: versão detalhada (carro_hd.glb, ~5x mais triângulos: qualidade alta e câmera piloto);
# PWM_LO=1: versão leve (carro_lo.glb, ~1/3: qualidade baixa, PC fraco)
HD = os.environ.get("PWM_HD") == "1"
LO = os.environ.get("PWM_LO") == "1"
OUT = r"C:\Users\Kustela\f1-manager\public\car3d" + ("\\carro_hd.glb" if HD else "\\carro_lo.glb" if LO else "\\carro.glb")
# (leve: 60% na carroceria e quase tudo nas rodas e asas; com 1/3 a malha rasgava)
TRIS = {k: int(v * (5 if HD else (0.6 if k == "corpo" else 0.85) if LO else 1)) for k, v in {"corpo": 9000, "asa_d": 1500, "asa_t": 1500, "roda": 1500, "volante": 1200, "bracos": 1800, "capacete": 8000, "piloto": 4000, "telinha": 100000, "tampa": 100000}.items()}
sc = bpy.context.scene

for n in ("ground", "light_half_sphere", "ferrari_dashboard_screen", "bee+_logo_grey-01", "steering_wheel_display_glass.002", *(f"helmet shell.00{i}" for i in range(1, 6))):
    o = bpy.data.objects.get(n)
    if o:
        o.hide_render = True
# (o capacete do piloto vem escondido no arquivo: liga)
bpy.data.objects["helmet"].hide_render = False
# ("GT3 Racing Helmet": um segundo capacete com várias peças, por cima do do piloto; ia pra carroceria, cinza,
# e brigava com a viseira) — esconde ele e tudo dentro dele
for o in bpy.data.objects:
    a = o
    while a:
        if a.name.startswith("GT3 Racing Helmet"):
            o.hide_render = True
            break
        a = a.parent
for c in bpy.data.collections:
    if "Widgets" in c.name or c.name == "simple_scene":
        c.hide_render = True


def visible(o):
    return not o.hide_render and not any(c.hide_render for c in o.users_collection)


vis = [o for o in sc.objects if o.type == "MESH" and visible(o)]
BODY = {"body_object", "mirror_main_body_at01"}
WING = {"front_wing_mixer", "rear_wing_no_mod", "drs_wing_part", "rear_wing_drs_flap_sides"}
HELM = {"helmet"}


def wheel(w, p):
    end = "front" if w.startswith("Ft") else "rear"
    out = {f"wheel.{w}_object", f"{p}_rim_{end}", f"{p}_tire_ventil_{end}", f"{p}_wheel_cover_{end}_new", f"{p}_wheel_naboj_{end}", f"{p}_wheel_nut_{end}"}
    # (o "tambor" do duto de freio vai junto com a roda: parado, aparecia por dentro dela como peça solta)
    for o in bpy.data.objects:
        a = o
        while a:
            if a.name == f"wheelbrake.{w}" or a.name == f"wheelbrake.{w}_object":
                # (aletas e a proteção em cima da roda ficam paradas, como no carro de verdade; só o tambor redondo gira)
                if "fins" not in o.name and "blades" not in o.name and "brakes_duct" not in o.name and "brakeduct" not in o.name:
                    out.add(o.name)
                break
            a = a.parent
    return out


# peças do freio da frente que NÃO giram (proteção, aletas, dutos): esterçam junto com a roda, sem rodar
def brake_static(w):
    out = set()
    for o in bpy.data.objects:
        a = o
        while a:
            if a.name == f"wheelbrake.{w}" or a.name == f"wheelbrake.{w}_object":
                if "fins" in o.name or "blades" in o.name or "brakes_duct" in o.name or "brakeduct" in o.name:
                    out.add(o.name)
                break
            a = a.parent
    return out


# centro de cada roda pelo pneu só (o duto de freio junto tirava o centro do eixo e a roda balançava)
def tyre_center(w):
    o = bpy.data.objects[f"wheel.{w}_object"]
    ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
    ps = [ev.matrix_world @ Vector(c) for c in ev.bound_box]
    return sum(ps, Vector()) / 8


TYRE_C = {"roda_fe": tyre_center("Ft.L"), "roda_fd": tyre_center("Ft.R"), "roda_te": tyre_center("Bk.L"), "roda_td": tyre_center("Bk.R")}
TYRE_C["freio_fe"] = TYRE_C["roda_fe"]
TYRE_C["freio_fd"] = TYRE_C["roda_fd"]


# volante (gira com o esterço; a telinha leva a velocidade), capacete (inclina na curva) e braços do piloto
# (giram junto com o volante, em volta do centro dele)
STEER = {c.name for c in bpy.data.objects["steering_and_drs"].children if c.name.startswith(("steering_wheel", "paddle")) and "display" not in c.name}
LAYERS = {
    "volante": STEER,
    # (a tela do volante: o jogo desenha marcha e velocidade nela e prende no volante)
    "telinha": {"steering_wheel_display_emmiter.002"},
    "capacete": set(HELM),
    "asa_d": {"front_wing_mixer", "front_wing_holders"},
    "asa_t": {"rear_wing_no_mod", "drs_wing_part", "drs_holder", "rear_wing_drs_flap_sides", "drs_mechanism_link", "drs_mechanism_pins", "drs_mechanism_pins.001", "drs_mechanism_inside"},
    "freio_fe": brake_static("Ft.L"),
    "freio_fd": brake_static("Ft.R"),
    "roda_fe": wheel("Ft.L", "fl"),
    "roda_fd": wheel("Ft.R", "fr"),
    "roda_te": wheel("Bk.L", "rl"),
    "roda_td": wheel("Bk.R", "rr"),
}


def center(o):
    ps = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return sum(ps, Vector()) / len(ps)


# a roda é só o que gira (pneu, aro, capa, cubo e porca): freio e duto de freio ficam no corpo, parados
# (juntos, eles tiravam o centro da roda do eixo e ela "andava" pra frente e pra trás girando)
ALL = set().union(*LAYERS.values())
group_of = {n: t for t, ns in LAYERS.items() for n in ns}
# o piloto (corpo, braços e pernas) é uma peça só, com as poses do volante virado (morph "giro_mais"/"giro_menos")
for n in ("racer", "shoes.l", "shoes.r"):
    group_of[n] = "piloto"
# quanto o volante vira nas poses extras (o jogo mistura entre o meio e elas)
GIRO = math.radians(50)


def flat(name, col, metal=0.0, rough=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col[:3], 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    return m


PAINT = flat("pintura", (0.8, 0.8, 0.8), 0.2, 0.3)
SCREEN = flat("telinha", (0.03, 0.03, 0.03), 0.0, 0.3)
# piloto: macacão e capacete com a cor da equipe (o jogo pinta pelo nome), viseira escura
SUIT = flat("macacao", (0.8, 0.8, 0.8), 0.0, 0.7)
VISOR = flat("viseira", (0.02, 0.025, 0.035), 0.4, 0.08)
DRIVER = {"racer", "shoes.l", "shoes.r"}
SPLIT_HANDS = False
DARK = flat("preto_piloto", (0.04, 0.04, 0.045), 0.0, 0.6)


def driver_mat(m):
    # (as cores do piloto vêm de nós ligados: sem isso tudo virava cinza)
    n = (m.name if m else "").lower()
    # (o corpo do piloto é "blacklather": entra no macacão com a cor da equipe)
    if n in ("suit", "leather2", "blacklather"):
        return SUIT
    if n == "blackdiffuse":
        return DARK
    return HELMM if n == "helmet" else VISOR if n == "glass" else simple(m)
WINGM = flat("asa", (0.8, 0.8, 0.8), 0.2, 0.35)
HELMM = flat("capacete", (0.8, 0.8, 0.8), 0.1, 0.25)
cache = {}


def simple(m):
    """material do modelo -> cor lisa (a cor base dele, ou um cinza) com o mesmo brilho"""
    if not m:
        return flat("liso", (0.2, 0.2, 0.2))
    if m.name in cache:
        return cache[m.name]
    col, metal, rough = (0.25, 0.25, 0.27), 0.0, 0.5
    if m.use_nodes:
        b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if b:
            bc = b.inputs["Base Color"]
            if not bc.is_linked:
                col = tuple(bc.default_value[:3])
            metal = b.inputs["Metallic"].default_value if not b.inputs["Metallic"].is_linked else 0.3
            rough = b.inputs["Roughness"].default_value if not b.inputs["Roughness"].is_linked else 0.5
    n = m.name.lower()
    if "sticker" in n or "dashboard" in n or "display_screen" in n:
        col = (0.03, 0.03, 0.03)
    if "tire" in n or "rubber" in n or "tyre" in n:
        col, metal, rough = (0.05, 0.05, 0.05), 0.0, 0.8
    if "carbon" in n:
        col, metal, rough = (0.06, 0.06, 0.065), 0.3, 0.4
    cache[m.name] = flat("m_" + m.name[:40], col, metal, rough)
    return cache[m.name]


# malhas no mundo (já com o rig e os modificadores), agrupadas por peça
dg = bpy.context.evaluated_depsgraph_get()
groups = {t: [] for t in ["corpo", "bracos", "piloto", *LAYERS.keys()]}
for o in vis:
    ev = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    me.transform(o.matrix_world)
    for i, m in enumerate(me.materials):
        me.materials[i] = PAINT if o.name in BODY else WINGM if o.name in WING else driver_mat(m) if o.name in HELM else SCREEN if "display_emmiter" in o.name else driver_mat(m) if o.name in DRIVER else simple(m)
    if not me.materials:
        me.materials.append(simple(None))
    # (mãos separadas pra girar com o volante: o corte entre mão e braço ficava aberto depois de simplificar;
    # por enquanto ficam no corpo e só o volante gira)
    if o.name == "racer" and SPLIT_HANDS:
        # braços (ombro pra baixo até os dedos): faces cujos pontos seguem mais esses ossos viram outra peça
        import bmesh
        # (só as mãos: o braço inteiro girando em volta do volante descolava do ombro)
        arm = {i for i, g in enumerate(o.vertex_groups) if any(k in g.name for k in ("hand", "f_", "thumb", "palm"))}
        me2 = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
        me2.transform(o.matrix_world)
        bm = bmesh.new()
        bm.from_mesh(me2)
        def is_arm(v, dl):
            if not dl or not v[dl]:
                return False
            g = max(v[dl].items(), key=lambda kv: kv[1])[0]
            return g in arm
        dl = bm.verts.layers.deform.active
        body_faces = [f for f in bm.faces if sum(is_arm(v, dl) for v in f.verts) * 2 < len(f.verts)]
        arms = bm.copy()
        bmesh.ops.delete(bm, geom=body_faces, context="FACES")
        bm.to_mesh(me2)
        bm.free()
        dl2 = arms.verts.layers.deform.active
        arm_faces = [f for f in arms.faces if sum(is_arm(v, dl2) for v in f.verts) * 2 >= len(f.verts)]
        bmesh.ops.delete(arms, geom=arm_faces, context="FACES")
        arms.to_mesh(me)
        arms.free()
        for i, m in enumerate(me2.materials):
            me2.materials[i] = driver_mat(m)
        na = bpy.data.objects.new("tmp_bracos", me2)
        sc.collection.objects.link(na)
        groups["bracos"].append(na)
    if o.name in BODY:
        # duto da entrada de ar escuro desde a boca: faces de pintura dentro do tubo (atrás da boca, y > 2,28)
        # e viradas pro meio dele viram preto; a borda da frente continua com a cor da equipe
        if DARK.name not in [m.name for m in me.materials if m]:
            me.materials.append(DARK)
        di = [m.name if m else "" for m in me.materials].index(DARK.name)
        for pl in me.polygons:
            if me.materials[pl.material_index] is not PAINT:
                continue
            c = pl.center
            if not (2.28 < c.y < 2.95 and ((c.x - 0.063) / 0.13) ** 2 + ((c.z - 0.982) / 0.11) ** 2 < 1):
                continue
            if pl.normal.x * (c.x - 0.063) + pl.normal.z * (c.z - 0.982) < 0:
                pl.material_index = di
    if o.name in DRIVER:
        # (o capacete embutido no piloto sai: o separado, mais limpo, fica no lugar; os dois juntos brigavam)
        import bmesh
        bm3 = bmesh.new()
        bm3.from_mesh(me)
        drop = [f for f in bm3.faces if f.material_index < len(me.materials) and me.materials[f.material_index] in (HELMM, VISOR)]
        # (a cabeça do piloto fica dentro do capacete; com o capacete inclinado pra frente no jogo ela aparecia
        # por baixo dele, como um segundo capacete: sai tudo que está dentro da caixa do capacete)
        hev = bpy.data.objects["helmet"].evaluated_get(dg)
        hme = hev.to_mesh()
        hp = [hev.matrix_world @ v.co for v in hme.vertices]
        hev.to_mesh_clear()
        lo3 = Vector((min(v.x for v in hp), min(v.y for v in hp), min(v.z for v in hp)))
        hi3 = Vector((max(v.x for v in hp), max(v.y for v in hp), max(v.z for v in hp)))
        inside = lambda c: all(lo3[i] - 0.01 <= c[i] <= hi3[i] + 0.01 for i in range(3))
        # (não corta: puxa pro meio do capacete os pontos que ficam dentro dele — pescoço e cabeça somem lá
        # dentro e o macacão continua inteiro)
        hc = (lo3 + hi3) / 2
        for v in bm3.verts:
            if inside(v.co):
                v.co = hc + (v.co - hc) * 0.62
        bmesh.ops.delete(bm3, geom=drop, context="FACES")
        bm3.to_mesh(me)
        bm3.free()
    no = bpy.data.objects.new("tmp_" + o.name, me)
    sc.collection.objects.link(no)
    groups[group_of.get(o.name, "corpo")].append(no)

final = []
steer_center = None
# tampa da entrada de ar (em cima do piloto): na frente da boca, ligando as bordas de dentro do duto
# (raios do meio pra parede, um a cada 7,5°; o ponto fica 3 mm dentro da parede pra não abrir fresta)
corpo_ob = next((o for t, objs in groups.items() if t == "corpo" for o in objs), None)
# (desligada: o usuário preferiu ver o duto por dentro; o jogo desenha o lado de dentro escuro)
if False and corpo_ob is not None:
    from mathutils.bvhtree import BVHTree
    from mathutils import Vector as V3
    import math as _m
    cb = groups["corpo"]
    vs, fs_ = [], []
    for o2 in cb:
        base = len(vs)
        vs += [o2.matrix_world @ v.co for v in o2.data.vertices]
        fs_ += [[base + i for i in pl.vertices] for pl in o2.data.polygons]
    bvh = BVHTree.FromPolygons(vs, fs_)
    c0 = V3((0.063, 2.30, 0.982))
    ring, rs = [], []
    for k in range(48):
        a = 2 * _m.pi * k / 48
        d = V3((_m.cos(a), 0, _m.sin(a)))
        hit = bvh.ray_cast(c0, d, 0.3)
        # (a abertura medida: oval de ~18,5 x 14,5 cm; raio que escapa por fresta fica no contorno dela)
        oval = 1 / _m.sqrt((_m.cos(a) / 0.094) ** 2 + (_m.sin(a) / 0.074) ** 2)
        r = hit[3] if hit[0] is not None and hit[3] < oval * 1.2 else oval
        rs.append(r)
        ring.append(c0 + d * (r + 0.003))
    print("tampa da entrada de ar: raio", round(min(rs), 3), "a", round(max(rs), 3))
    cm = bpy.data.meshes.new("tampa")
    cm.from_pydata([c0] + ring, [], [[0, 1 + k, 1 + (k + 1) % 48] for k in range(48)])
    cm.materials.append(DARK)
    cap = bpy.data.objects.new("tampa", cm)
    sc.collection.objects.link(cap)
    groups.setdefault("tampa", []).append(cap)
for t, objs in groups.items():
    if not objs:
        continue
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = t
    ob.data.name = t
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    goal = TRIS["roda" if t.startswith(("roda", "freio")) else t]
    # (a telinha do volante não pode ser simplificada: perde o quadrado onde a velocidade é desenhada)
    if tris > goal:
        d = ob.modifiers.new("simplifica", "DECIMATE")
        d.ratio = goal / tris
    # roda e volante: o centro (pra girar) no meio deles; braços giram em volta do centro do volante
    if t.startswith(("roda", "freio")):
        sc.cursor.location = TYRE_C[t]
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    if t == "volante":
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    if t == "volante":
        steer_center = ob.location.copy()
    print("peça", t, tris, "->", min(tris, goal))
    final.append(ob)

# poses do volante virado: os braços estão em IK e as mãos presas no volante (Child Of no steering_and_drs),
# então girar o osso do volante leva os braços inteiros junto. Piloto, volante e telinha ganham as mesmas
# poses (o jogo mistura as três juntas: a mão não atravessa o volante). Cada ponto já simplificado pega o
# deslocamento do ponto original mais perto dele.
from mathutils import Quaternion, kdtree
MORPH = [("piloto", ["racer", "shoes.l", "shoes.r"]), ("volante", sorted(STEER)), ("telinha", ["steering_wheel_display_emmiter.002"])]
alvos = [(next((o for o in final if o.name == g), None), [bpy.data.objects[n] for n in fontes]) for g, fontes in MORPH]
alvos = [(o, f) for o, f in alvos if o]
for o, _ in alvos:
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    for md in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=md.name)


def posed(fontes):
    dg2 = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in fontes:
        ev = o.evaluated_get(dg2)
        me3 = ev.to_mesh()
        out += [ev.matrix_world @ v.co for v in me3.vertices]
        ev.to_mesh_clear()
    return out


base = [posed(f) for _, f in alvos]
sw = bpy.data.objects["steering_and_drs"].pose.bones["steering_wheel"]
q0 = sw.rotation_quaternion.copy()
poses = {}
# (várias poses, a cada 1/3 do giro: misturar só duas vizinhas mantém o volante redondo; com uma só ele
# encolhia e afundava no meio do caminho)
for nm, ang in [(('giro_p' if sg > 0 else 'giro_m') + str(i), sg * GIRO * i / 3) for sg in (1, -1) for i in (1, 2, 3)]:
    sw.rotation_quaternion = q0 @ Quaternion((0, 1, 0), ang)
    bpy.context.view_layer.update()
    poses[nm] = [posed(f) for _, f in alvos]
sw.rotation_quaternion = q0
bpy.context.view_layer.update()
for gi, (o, _) in enumerate(alvos):
    C = base[gi]
    kd = kdtree.KDTree(len(C))
    for i, c in enumerate(C):
        kd.insert(c, i)
    kd.balance()
    near = [kd.find(o.matrix_world @ v.co)[1] for v in o.data.vertices]
    o.shape_key_add(name="Basis")
    for nm in poses:
        P = poses[nm][gi]
        k = o.shape_key_add(name=nm, from_mix=False)
        for i, v in enumerate(o.data.vertices):
            j = near[i]
            k.data[i].co = v.co + (P[j] - C[j])
    # (todas as poses desligadas no arquivo: ligadas juntas, quem abre o arquivo vê o volante amassado)
    for kb in o.data.shape_keys.key_blocks:
        kb.value = 0.0
    print("poses do volante em", o.name, len(o.data.vertices), "pontos")

arms = next((o for o in final if o.name == "bracos"), None)
if arms and steer_center is not None:
    bpy.ops.object.select_all(action="DESELECT")
    arms.select_set(True)
    bpy.context.view_layer.objects.active = arms
    sc.cursor.location = steer_center
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
for o in sc.objects:
    o.select_set(o in final)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True, export_animations=False, export_yup=True, export_materials="EXPORT")
print("carro glb ok")
