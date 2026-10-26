# Carro 3D de verdade (Three.js) pra corrida: public/car3d/carro.glb
# uso: blender -b --factory-startup --disable-autoexec <fp04rb_new_rig.blend> --python art/export_carro_glb.py
# depois comprimir: npx @gltf-transform/cli@4.1.1 meshopt public/car3d/carro.glb public/car3d/carro.glb
# Peças separadas (o jogo esconde/gira cada uma): corpo, asa_d, asa_t e as 4 rodas (com o centro no eixo).
# Materiais com nome fixo pro jogo pintar: pintura (cor da equipe), asa (cor da asa), capacete; o resto vira
# cor lisa (sem textura) e a malha é simplificada pra 20 carros rodarem leve.
import bpy, math
from mathutils import Vector

OUT = r"C:\Users\Kustela\f1-manager\public\car3d\carro.glb"
TRIS = {"corpo": 9000, "asa_d": 1500, "asa_t": 1500, "roda": 1500}
sc = bpy.context.scene

for n in ("ground", "light_half_sphere", "ferrari_dashboard_screen", "bee+_logo_grey-01"):
    o = bpy.data.objects.get(n)
    if o:
        o.hide_render = True
for c in bpy.data.collections:
    if "Widgets" in c.name or c.name == "simple_scene":
        c.hide_render = True


def visible(o):
    return not o.hide_render and not any(c.hide_render for c in o.users_collection)


vis = [o for o in sc.objects if o.type == "MESH" and visible(o)]
BODY = {"body_object", "mirror_main_body_at01"}
WING = {"front_wing_mixer", "rear_wing_no_mod", "drs_wing_part", "rear_wing_drs_flap_sides"}
HELM = {"shell"}


def wheel(w, p):
    end = "front" if w.startswith("Ft") else "rear"
    return {f"wheel.{w}_object", f"{p}_rim_{end}", f"{p}_tire_ventil_{end}", f"{p}_wheel_cover_{end}_new", f"{p}_wheel_naboj_{end}", f"{p}_wheel_nut_{end}"}


LAYERS = {
    "asa_d": {"front_wing_mixer", "front_wing_holders"},
    "asa_t": {"rear_wing_no_mod", "drs_wing_part", "drs_holder", "rear_wing_drs_flap_sides", "drs_mechanism_link", "drs_mechanism_pins", "drs_mechanism_pins.001", "drs_mechanism_inside"},
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


def flat(name, col, metal=0.0, rough=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col[:3], 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    return m


PAINT = flat("pintura", (0.8, 0.8, 0.8), 0.2, 0.3)
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
groups = {t: [] for t in ["corpo", *LAYERS.keys()]}
for o in vis:
    ev = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    me.transform(o.matrix_world)
    for i, m in enumerate(me.materials):
        me.materials[i] = PAINT if o.name in BODY else WINGM if o.name in WING else HELMM if o.name in HELM else simple(m)
    if not me.materials:
        me.materials.append(simple(None))
    no = bpy.data.objects.new("tmp_" + o.name, me)
    sc.collection.objects.link(no)
    groups[group_of.get(o.name, "corpo")].append(no)

final = []
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
    goal = TRIS["roda" if t.startswith("roda") else t]
    if tris > goal:
        d = ob.modifiers.new("simplifica", "DECIMATE")
        d.ratio = goal / tris
    # roda: o centro (pra girar e esterçar) no meio dela
    if t.startswith("roda"):
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    print("peça", t, tris, "->", min(tris, goal))
    final.append(ob)

for o in sc.objects:
    o.select_set(o in final)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True, export_animations=False, export_yup=True, export_materials="EXPORT")
print("carro glb ok")
