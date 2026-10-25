# Render da câmera onboard (olhos do piloto) pro jogo (public/onboard).
# uso: blender -b --factory-startup --disable-autoexec <fp04rb_new_rig.blend> --python art/render_onboard.py
# Saída: base_corpo/base_volante (luz e reflexos) + mask_* (R carroceria, G asa) e info.json com
# o centro do volante e a telinha dele na imagem (o jogo gira o volante e escreve marcha/velocidade).
import bpy, math, json
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

OUT = r"C:\Users\Kustela\f1-manager\public\onboard"
RES = (1280, 720)
sc = bpy.context.scene

for n in ("ground", "light_half_sphere", "ferrari_dashboard_screen", "bee+_logo_grey-01"):
    o = bpy.data.objects.get(n)
    if o:
        o.hide_render = True
for c in bpy.data.collections:
    # sem o capacete e o corpo do piloto: a câmera está nos olhos dele
    if "Widgets" in c.name or c.name in ("simple_scene", "helmet", "driver", "new_driver"):
        c.hide_render = True
for o in bpy.data.objects:
    if o.type == "LIGHT":
        o.hide_render = True


def visible(o):
    return not o.hide_render and not any(c.hide_render for c in o.users_collection)


vis = [o for o in sc.objects if o.type == "MESH" and visible(o)]
WHEEL = {o.name for o in vis if "steering_wheel" in o.name or "paddle" in o.name}
BODY = {"body_object", "mirror_main_body_at01"}
WING = {"front_wing_mixer", "rear_wing_no_mod", "drs_wing_part", "rear_wing_drs_flap_sides"}

# câmera nos olhos do piloto, olhando pra frente (-Y) um pouco pra baixo
cam = bpy.data.cameras.new("pov")
cam.lens_unit = "FOV"
cam.angle = math.radians(92)
cam.clip_start = 0.02
co = bpy.data.objects.new("pov", cam)
sc.collection.objects.link(co)
co.location = (0.065, 2.16, 0.94)
co.rotation_euler = (math.radians(77), 0, math.radians(180))
sc.camera = co
sc.render.resolution_x, sc.render.resolution_y = RES
sc.render.resolution_percentage = 100
sc.render.film_transparent = True
eng = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in eng else "BLENDER_EEVEE"
sc.render.image_settings.color_depth = "8"
sc.render.image_settings.compression = 100

sun = bpy.data.lights.new("sun", "SUN")
sun.energy = 3.0
sun.angle = math.radians(10)
so = bpy.data.objects.new("sun", sun)
sc.collection.objects.link(so)
so.rotation_euler = (math.radians(35), math.radians(-20), math.radians(160))
sc.world = sc.world or bpy.data.worlds.new("w")
sc.world.use_nodes = True
bg = next(n for n in sc.world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = (0.6, 0.65, 0.72, 1)
bg.inputs[1].default_value = 1.0


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
DARK = principled("pwm_preto", (0.03, 0.03, 0.03), 0.0, 0.5)


def setall(o, m):
    if not o.data.materials:
        o.data.materials.append(m)
    for i in range(len(o.data.materials)):
        o.data.materials[i] = m


for o in vis:
    for i, m in enumerate(o.data.materials):
        if m and ("sticker" in m.name or "dashboard" in m.name or "display_screen" in m.name):
            o.data.materials[i] = DARK
    if o.name in BODY | WING:
        setall(o, PAINT)


def layer(tag):
    for o in vis:
        o.hide_render = (o.name in WHEEL) != (tag == "volante")


for tag in ("corpo", "volante"):
    layer(tag)
    sc.render.filepath = OUT + "\\base_" + tag + ".png"
    bpy.ops.render.render(write_still=True)


# onde ficam o centro do volante e a telinha, em fração da imagem (0..1, y de cima pra baixo)
def proj(names):
    pts = []
    for n in names:
        o = bpy.data.objects[n]
        for c in o.bound_box:
            v = world_to_camera_view(sc, co, o.matrix_world @ Vector(c))
            pts.append((v.x, 1 - v.y))
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return [min(xs), min(ys), max(xs), max(ys)]


wheel_box = proj(sorted(WHEEL))
disp = [n for n in WHEEL if "display_glass" in n]
disp_box = proj(disp) if disp else wheel_box

# molde de pintura (emissão pura)
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


E0, ER, EG = emis("m0", (0, 0, 0)), emis("mr", (1, 0, 0)), emis("mg", (0, 1, 0))
for o in vis:
    setall(o, ER if o.name in BODY else EG if o.name in WING else E0)
for tag in ("corpo", "volante"):
    layer(tag)
    sc.render.filepath = OUT + "\\mask_" + tag + ".png"
    bpy.ops.render.render(write_still=True)
json.dump({"w": RES[0], "h": RES[1], "wheel": wheel_box, "display": disp_box}, open(OUT + "\\info.json", "w"))
print("onboard ok", wheel_box, disp_box)
