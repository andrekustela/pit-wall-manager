# Carro visto de trás (pros carros à frente na câmera onboard), pintável: public/onboard/base_tras<i>.png + mask_tras<i>.png,
# em YAWS ângulos (yaw > 0 = o bico aponta pra direita da tela: na curva dá pra ver a lateral dele).
# uso: blender -b --factory-startup --disable-autoexec <fp04rb_new_rig.blend> --python art/render_traseira.py
import bpy, math, json
from mathutils import Vector

OUT = r"C:\Users\Kustela\f1-manager\public\onboard"
PXM = 140
YAWS = [-60, -40, -25, -15, -8, 0, 8, 15, 25, 40, 60]
sc = bpy.context.scene
for n in ("ground", "light_half_sphere", "ferrari_dashboard_screen", "bee+_logo_grey-01"):
    o = bpy.data.objects.get(n)
    if o:
        o.hide_render = True
for c in bpy.data.collections:
    if "Widgets" in c.name or c.name == "simple_scene":
        c.hide_render = True
for o in bpy.data.objects:
    if o.type == "LIGHT":
        o.hide_render = True
vis = [o for o in sc.objects if o.type == "MESH" and not o.hide_render and not any(c.hide_render for c in o.users_collection)]
BODY = {"body_object", "mirror_main_body_at01"}
WING = {"front_wing_mixer", "rear_wing_no_mod", "drs_wing_part", "rear_wing_drs_flap_sides"}
HELM = {"shell"}

mn = Vector((1e9,) * 3)
mx = Vector((-1e9,) * 3)
for o in vis:
    for c in o.bound_box:
        p = o.matrix_world @ Vector(c)
        mn = Vector(map(min, mn, p))
        mx = Vector(map(max, mx, p))
W, Hh = mx.x - mn.x, mx.z - mn.z
pad = 0.08
cam = bpy.data.cameras.new("tras")
cam.type = "ORTHO"
cam.ortho_scale = W + 2 * pad
co = bpy.data.objects.new("tras", cam)
sc.collection.objects.link(co)
# atrás do carro (+Y), na altura dele, olhando reto pra frente (-Y): sem ver o "teto" (inclinado parecia empinando)
Lc = mx.y - mn.y
ctr = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, (mn.z + mx.z) / 2 + 0.05))
sc.camera = co


def aim(yaw):
    """câmera girando em volta do carro; devolve a largura da imagem (m)"""
    a = math.radians(yaw)
    co.location = ctr + Vector((-12 * math.sin(a), 12 * math.cos(a), 0))
    co.rotation_euler = (math.radians(90), 0, math.radians(180) + a)
    wid = W * abs(math.cos(a)) + Lc * abs(math.sin(a)) + 2 * pad
    cam.ortho_scale = wid
    sc.render.resolution_x = round(wid * PXM)
    return wid


sc.render.resolution_y = round((Hh + 2 * pad + 0.5) * PXM)
sc.render.resolution_percentage = 100
sc.render.film_transparent = True
eng = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in eng else "BLENDER_EEVEE"
sc.render.image_settings.color_depth = "8"
sc.render.image_settings.compression = 100
sun = bpy.data.lights.new("sun", "SUN")
sun.energy = 3.2
so = bpy.data.objects.new("sun", sun)
sc.collection.objects.link(so)
so.rotation_euler = (math.radians(40), math.radians(-25), 0)
sc.world = sc.world or bpy.data.worlds.new("w")
sc.world.use_nodes = True
bg = next(n for n in sc.world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = (0.6, 0.62, 0.66, 1)
bg.inputs[1].default_value = 0.9


def principled(name, col, metal, rough, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if "Coat Weight" in b.inputs:
        b.inputs["Coat Weight"].default_value = coat
    return m


PAINT = principled("pwm_pintura", (0.82, 0.82, 0.82), 0.15, 0.28, 0.7)
SUIT = principled("pwm_macacao", (0.12, 0.12, 0.13), 0.0, 0.7)
DARK = principled("pwm_preto", (0.03, 0.03, 0.03), 0.0, 0.5)


def setall(o, m):
    if not o.data.materials:
        o.data.materials.append(m)
    for i in range(len(o.data.materials)):
        o.data.materials[i] = m


for o in vis:
    for i, m in enumerate(o.data.materials):
        if not m:
            continue
        if m.name in ("helmet", "Material_map.001"):
            o.data.materials[i] = PAINT if o.name in HELM else SUIT
        elif "sticker" in m.name or "dashboard" in m.name or "display_screen" in m.name:
            o.data.materials[i] = DARK
    if o.name in BODY | WING | HELM:
        setall(o, PAINT)
wids = []
for i, y in enumerate(YAWS):
    wids.append(aim(y))
    sc.render.filepath = OUT + f"\\base_tras{i}.png"
    bpy.ops.render.render(write_still=True)

vt = [i.identifier for i in bpy.types.ColorManagedViewSettings.bl_rna.properties["view_transform"].enum_items]
if "Standard" in vt:
    sc.view_settings.view_transform = "Standard"
so.hide_render = True
bg.inputs[1].default_value = 0.0


def emis(name, col):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs[0].default_value = (*col, 1)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(e.outputs[0], out.inputs[0])
    return m


E0, ER, EG, EB = emis("m0", (0, 0, 0)), emis("mr", (1, 0, 0)), emis("mg", (0, 1, 0)), emis("mb", (0, 0, 1))
for o in vis:
    setall(o, ER if o.name in BODY else EG if o.name in WING else EB if o.name in HELM else E0)
for i, y in enumerate(YAWS):
    aim(y)
    sc.render.filepath = OUT + f"\\mask_tras{i}.png"
    bpy.ops.render.render(write_still=True)
json.dump({"widM": W + 2 * pad, "carWid": W, "yaws": YAWS, "widsM": wids}, open(OUT + "\\tras.json", "w"))
print("traseira ok", sc.render.resolution_x, sc.render.resolution_y)
