# Safety car e guindaste vistos de cima (vista principal da corrida): public/props/<nome>.png + <nome>.json.
# uso:
#   blender -b --factory-startup --disable-autoexec <safetycar.blend> --python art/render_props.py -- sc
#   blender -b --factory-startup --python art/render_props.py -- crane <prop_crane.obj>
# Imagem com o bico apontando pra direita (como os carros), PXM pixels por metro.
import bpy, sys, math, json, os
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
NAME = args[0]
OUT = r"C:\Users\Kustela\f1-manager\public\props"
os.makedirs(OUT, exist_ok=True)
PXM = 60
if NAME == "crane":
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.obj_import(filepath=args[1])
sc = bpy.context.scene
for o in sc.objects:
    if o.type in ("LIGHT", "CAMERA"):
        o.hide_render = True
ms = [o for o in sc.objects if o.type == "MESH" and not o.hide_render]


def principled(name, col, metal, rough, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    return m


GLASS = principled("pwm_vidro", (0.03, 0.04, 0.06), 0.3, 0.08)
YELLOW = principled("pwm_amarelo", (0.95, 0.62, 0.05), 0.1, 0.4)
BLACK = principled("pwm_preto", (0.04, 0.04, 0.045), 0.0, 0.6)
for o in ms:
    for i, m in enumerate(o.data.materials):
        if not m:
            continue
        n = m.name.lower()
        if "glass" in n or "window" in n or "tint" in n:
            o.data.materials[i] = GLASS
        elif NAME == "crane":
            o.data.materials[i] = YELLOW if "yellow" in n else BLACK

# vértices no mundo
pts = [o.matrix_world @ v.co for o in ms for v in o.data.vertices]
lo = Vector([min(p[k] for p in pts) for k in range(3)])
hi = Vector([max(p[k] for p in pts) for k in range(3)])
if NAME == "crane":
    # o caminhão veio girado: eixo principal da parte de baixo (chassi) e a frente = lado da ponta da lança
    low = [p for p in pts if p.z < lo.z + (hi.z - lo.z) * 0.25]
    cx = sum(p.x for p in low) / len(low)
    cy = sum(p.y for p in low) / len(low)
    sxx = sum((p.x - cx) ** 2 for p in low)
    syy = sum((p.y - cy) ** 2 for p in low)
    sxy = sum((p.x - cx) * (p.y - cy) for p in low)
    ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
    tip = [p for p in pts if p.z > lo.z + (hi.z - lo.z) * 0.85]
    tx = sum(p.x for p in tip) / len(tip) - cx
    ty = sum(p.y for p in tip) / len(tip) - cy
    if tx * math.cos(ang) + ty * math.sin(ang) < 0:
        ang += math.pi
    # gira tudo pra frente = +X
    for o in ms:
        o.rotation_euler.z -= ang
        o.location = Vector((cx, cy, 0)) + (o.location - Vector((cx, cy, 0)))
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ v.co for o in ms for v in o.data.vertices]
    lo = Vector([min(p[k] for p in pts) for k in range(3)])
    hi = Vector([max(p[k] for p in pts) for k in range(3)])
    FWD = Vector((1, 0, 0))
    REAL_LEN = 12.0  # m (guindaste de pista)
else:
    # o safety car olha pra -Y; o modelo é maior que um carro de verdade
    FWD = Vector((0, -1, 0))
    REAL_LEN = 4.9

along = lambda p: p.dot(FWD)
L = max(along(p) for p in pts) - min(along(p) for p in pts)
k = (REAL_LEN / L) if REAL_LEN else 1.0  # metros por unidade
side = Vector((-FWD.y, FWD.x, 0))
Wd = max(p.dot(side) for p in pts) - min(p.dot(side) for p in pts)
ctr = (lo + hi) / 2
pad = 0.05 / k
cam = bpy.data.cameras.new("top")
cam.type = "ORTHO"
cam.ortho_scale = L + 2 * pad
co = bpy.data.objects.new("top", cam)
sc.collection.objects.link(co)
sc.camera = co
co.location = (ctr.x, ctr.y, hi.z + 10 / k)
cam.clip_end = (hi.z - lo.z + 20 / k) * 2
# direita da imagem = frente
co.rotation_euler = (0, 0, math.atan2(FWD.y, FWD.x))
sc.render.resolution_x = round((L + 2 * pad) * k * PXM)
sc.render.resolution_y = round((Wd + 2 * pad) * k * PXM)
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
so.rotation_euler = (math.radians(25), math.radians(-15), 0)
sc.world = sc.world or bpy.data.worlds.new("w")
sc.world.use_nodes = True
bg = next(n for n in sc.world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = (0.6, 0.62, 0.68, 1)
bg.inputs[1].default_value = 0.9
sc.render.filepath = OUT + f"\\{NAME}.png"
bpy.ops.render.render(write_still=True)
info = {"lenM": (L + 2 * pad) * k, "widM": (Wd + 2 * pad) * k}
if NAME == "crane":
    # gancho: o ponto mais baixo do que está pendurado na frente (em metros, a partir do centro da imagem)
    front = [p for p in pts if along(p - ctr) > 0 and p.z < lo.z + (hi.z - lo.z) * 0.6 and p.z > lo.z + (hi.z - lo.z) * 0.2]
    far = max(front, key=lambda p: along(p - ctr))
    info["hookF"] = along(far - ctr) * k
    info["hookL"] = (far - ctr).dot(side) * k
json.dump(info, open(OUT + f"\\{NAME}.json", "w"))
print("props ok", NAME, info)
