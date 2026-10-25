# Renderiza o carro visto de cima: base (luz/reflexos, partes pintáveis em cinza claro) + molde (R=carroceria, G=asa, B=capacete)
import bpy, math, json, sys
from mathutils import Vector
OUT = r"C:\Users\Kustela\AppData\Local\Temp\claude\C--Users-Kustela\1e86f50e-6e08-48f9-9ca7-2eaf218b9ebe\scratchpad\car3d"
PXM = 120  # pixels por metro
sc = bpy.context.scene
for n in ("ground", "light_half_sphere", "ferrari_dashboard_screen", "bee+_logo_grey-01"):
    o = bpy.data.objects.get(n)
    if o: o.hide_render = True
for c in bpy.data.collections:
    if "Widgets" in c.name or c.name == "simple_scene": c.hide_render = True
for o in bpy.data.objects:
    if o.type == "LIGHT": o.hide_render = True
BODY = {"body_object", "mirror_main_body_at01"}
WING = {"front_wing_mixer", "rear_wing_no_mod", "drs_wing_part", "rear_wing_drs_flap_sides"}
HELM = {"shell"}
vis = [o for o in sc.objects if o.type == "MESH" and not o.hide_render and o.visible_get() is not None]
def visible(o):
    if o.hide_render: return False
    for c in o.users_collection:
        if c.hide_render: return False
    return True
vis = [o for o in sc.objects if o.type == "MESH" and visible(o)]
mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
for o in vis:
    for c in o.bound_box:
        p = o.matrix_world @ Vector(c); mn = Vector(map(min, mn, p)); mx = Vector(map(max, mx, p))
L = mx.y - mn.y; W = mx.x - mn.x
print("caixa", tuple(round(v, 3) for v in mn), tuple(round(v, 3) for v in mx), "comprimento", round(L, 3), "largura", round(W, 3))
pad = 0.15
LM, WM = L + 2 * pad, W + 2 * pad
cam = bpy.data.cameras.new("topcam"); cam.type = "ORTHO"; cam.ortho_scale = LM
co = bpy.data.objects.new("topcam", cam); sc.collection.objects.link(co)
co.location = ((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mx.z + 10); co.rotation_euler = (0, 0, math.radians(-90))
sc.camera = co
sc.render.resolution_x = round(LM * PXM); sc.render.resolution_y = round(WM * PXM); sc.render.resolution_percentage = 100
sc.render.film_transparent = True
eng = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in eng else "BLENDER_EEVEE"
vt = [i.identifier for i in bpy.types.ColorManagedViewSettings.bl_rna.properties["view_transform"].enum_items]
# luz: sol alto um pouco inclinado + luz ambiente
sun = bpy.data.lights.new("topsun", "SUN"); sun.energy = 3.2; sun.angle = math.radians(12)
so = bpy.data.objects.new("topsun", sun); sc.collection.objects.link(so); so.rotation_euler = (math.radians(18), math.radians(-12), 0)
fill = bpy.data.lights.new("fill", "SUN"); fill.energy = 0.8
fo = bpy.data.objects.new("fill", fill); sc.collection.objects.link(fo); fo.rotation_euler = (math.radians(-40), math.radians(30), 0)
sc.world = sc.world or bpy.data.worlds.new("w"); sc.world.use_nodes = True
bg = next(n for n in sc.world.node_tree.nodes if n.type == "BACKGROUND"); bg.inputs[0].default_value = (0.55, 0.57, 0.6, 1); bg.inputs[1].default_value = 0.9

def principled(name, col, metal, rough, coat=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col, 1); b.inputs["Metallic"].default_value = metal; b.inputs["Roughness"].default_value = rough
    for k in ("Coat Weight",):
        if k in b.inputs: b.inputs[k].default_value = coat
    return m
PAINT = principled("pwm_pintura", (0.82, 0.82, 0.82), 0.15, 0.28, 0.7)
SUIT = principled("pwm_macacao", (0.12, 0.12, 0.13), 0.0, 0.7)
DARK = principled("pwm_preto", (0.03, 0.03, 0.03), 0.0, 0.5)
def setall(o, m):
    if not o.data.materials: o.data.materials.append(m)
    for i in range(len(o.data.materials)): o.data.materials[i] = m
# sem marcas: textura do capacete, adesivos do volante, telas
for o in vis:
    for i, m in enumerate(o.data.materials):
        if not m: continue
        if m.name in ("helmet", "Material_map.001"): o.data.materials[i] = PAINT if o.name in HELM else SUIT
        elif "sticker" in m.name or "dashboard" in m.name or "display_screen" in m.name: o.data.materials[i] = DARK
for o in vis:
    if o.name in BODY | WING | HELM: setall(o, PAINT)
# camadas alinhadas: o carro sem a asa dianteira e a asa dianteira sozinha (pra ela poder quebrar/voar no jogo)
FW = {"front_wing_mixer", "front_wing_holders"}
def layer(only_fw):
    for o in vis: o.hide_render = (o.name in FW) != only_fw
sc.render.image_settings.color_depth = "8"
sc.render.image_settings.compression = 100
for tag, only in (("carro", False), ("asa", True)):
    layer(only)
    sc.render.filepath = OUT + "\\base_" + tag + ".png"
    bpy.ops.render.render(write_still=True)
print("base ok", sc.render.resolution_x, sc.render.resolution_y)

# molde: emissão pura, sem luz
if "Standard" in vt: sc.view_settings.view_transform = "Standard"
sc.view_settings.look = "None" if "None" in [i.identifier for i in bpy.types.ColorManagedViewSettings.bl_rna.properties["look"].enum_items] else sc.view_settings.look
so.hide_render = True; fo.hide_render = True
bg.inputs[1].default_value = 0.0
def emis(name, col):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    e = nt.nodes.new("ShaderNodeEmission"); e.inputs[0].default_value = (*col, 1); e.inputs[1].default_value = 1.0
    out = nt.nodes.new("ShaderNodeOutputMaterial"); nt.links.new(e.outputs[0], out.inputs[0]); return m
E0, ER, EG, EB = emis("m0", (0, 0, 0)), emis("mr", (1, 0, 0)), emis("mg", (0, 1, 0)), emis("mb", (0, 0, 1))
for o in vis:
    setall(o, ER if o.name in BODY else EG if o.name in WING else EB if o.name in HELM else E0)
for tag, only in (("carro", False), ("asa", True)):
    layer(only)
    sc.render.filepath = OUT + "\\mask_" + tag + ".png"
    bpy.ops.render.render(write_still=True)
json.dump({"pxPerM": PXM, "lenM": LM, "widM": WM, "carLen": L, "carWid": W, "centerX": (mn.x + mx.x) / 2, "centerY": (mn.y + mx.y) / 2}, open(OUT + r"\info.json", "w"))
print("molde ok")
