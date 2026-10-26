# Piloto em pé (pódio e editor do uniforme), pintável: public/piloto/<pose>.png + <pose>_mask.png
# (R macacão, G faixas do macacão, B casco do capacete) e piloto.json.
# uso: blender -b --factory-startup --disable-autoexec <fp04rb_new_rig.blend> --python art/render_piloto.py
# O esqueleto (rigify) sai do carro: tudo em FK, pose zerada (em pé) e os braços girados pra cada pose.
import bpy, math, json, os
from mathutils import Vector, Matrix

OUT = r"C:\Users\Kustela\f1-manager\public\piloto"
os.makedirs(OUT, exist_ok=True)
RES = (360, 480)
SCALE = 2.45  # metros na altura da imagem (com os braços pra cima)
# braço (graus pra cima, a partir de caído) e antebraço (dobra), esquerdo e direito
POSES = {
    "stand": ((10, 0), (10, 0)),
    "win": ((155, 10), (155, 10)),
    "p2": ((25, 10), (145, 15)),
    "p3": ((115, 45), (115, 45)),
}
sc = bpy.context.scene
rig = bpy.data.objects["rig"]
keep = {"racer", "shoes.r", "shoes.l", "helmet"}
helm = set(bpy.data.collections["helmet"].all_objects)
for o in sc.objects:
    o.hide_render = not (o.name in keep or o in helm)
for c in bpy.data.collections:
    if "Widgets" in c.name or c.name == "simple_scene":
        c.hide_render = True

# fora do carro, em FK, pose zerada
rig.parent = None
rig.matrix_world = Matrix()
for n in ("thigh_parent.L", "thigh_parent.R", "upper_arm_parent.L", "upper_arm_parent.R"):
    rig.pose.bones[n]["IK_FK"] = 1.0


def rest():
    for b in rig.pose.bones:
        b.location = (0, 0, 0)
        b.rotation_quaternion = (1, 0, 0, 0)
        b.rotation_euler = (0, 0, 0)
        b.scale = (1, 1, 1)
        for c in b.constraints:
            if getattr(c, "target", None) and c.target != rig:
                c.mute = True
    bpy.context.view_layer.update()


def raise_bone(name, deg, side, axis="Y"):
    """gira o osso em volta de um eixo do mundo, na base dele (Y = da frente: o braço sobe pro lado;
    X = de lado: a cabeça levanta com ângulo negativo)"""
    pb = rig.pose.bones[name]
    m = pb.matrix.copy()
    h = m.translation.copy()
    # (o piloto olha pra -Y: o lado esquerdo dele é +X; esquerdo sobe com ângulo negativo)
    r = Matrix.Translation(h) @ Matrix.Rotation(math.radians(-deg if side == "L" else deg), 4, axis) @ Matrix.Translation(-h)
    pb.matrix = r @ m
    bpy.context.view_layer.update()


def pose(name):
    rest()
    for side, (arm, fore) in zip(("L", "R"), POSES[name]):
        raise_bone(f"upper_arm_fk.{side}", arm, side)
        raise_bone(f"forearm_fk.{side}", fore, side)
    # cabeça erguida (no repouso o capacete olhava pro chão): o osso que leva a cabeça e o capacete,
    # sem as restrições dele (o controle "head" do rigify não chegava nele)
    for c in rig.pose.bones["ORG-spine.006"].constraints:
        c.mute = True
    raise_bone("ORG-spine.006", 32, "L", "X")


# materiais: claros onde a equipe pinta
def principled(name, col, metal, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    return m


SUIT = principled("pwm_macacao", (0.8, 0.8, 0.8), 0.0, 0.6)
STRIPE = principled("pwm_faixa", (0.85, 0.85, 0.85), 0.0, 0.5)
SHELL = principled("pwm_casco", (0.85, 0.85, 0.85), 0.1, 0.25)
vis = [o for o in sc.objects if o.type == "MESH" and not o.hide_render]
for o in vis:
    for i, m in enumerate(o.data.materials):
        if not m:
            continue
        if m.name == "blacklather":
            o.data.materials[i] = SUIT
        elif m.name == "leather2":
            o.data.materials[i] = STRIPE
        elif m.name in ("audi_white", "helmet"):
            o.data.materials[i] = SHELL

# câmera de frente, um pouco de lado (3/4), ortogonal
cam = bpy.data.cameras.new("pil")
cam.type = "ORTHO"
cam.ortho_scale = SCALE
co = bpy.data.objects.new("pil", cam)
sc.collection.objects.link(co)
sc.camera = co
a = math.radians(18)
mid = Vector((0, -0.16, SCALE / 2 - 0.12))
co.location = mid + Vector((math.sin(a) * 8, -math.cos(a) * 8, 0.4))
co.rotation_euler = (math.radians(90 - 2.8), 0, a)
sc.render.resolution_x, sc.render.resolution_y = RES
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
so.rotation_euler = (math.radians(55), 0, math.radians(-35))
sc.world = sc.world or bpy.data.worlds.new("w")
sc.world.use_nodes = True
bg = next(n for n in sc.world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = (0.6, 0.62, 0.68, 1)
bg.inputs[1].default_value = 0.8

for p in POSES:
    pose(p)
    sc.render.filepath = OUT + f"\\{p}.png"
    bpy.ops.render.render(write_still=True)

# moldes (emissão pura)
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


E = {SUIT: emis("mr", (1, 0, 0)), STRIPE: emis("mg", (0, 1, 0)), SHELL: emis("mb", (0, 0, 1))}
E0 = emis("m0", (0, 0, 0))
for o in vis:
    for i, m in enumerate(o.data.materials):
        o.data.materials[i] = E.get(m, E0)
for p in POSES:
    pose(p)
    sc.render.filepath = OUT + f"\\{p}_mask.png"
    bpy.ops.render.render(write_still=True)
# pé no chão: onde fica z = 0 na imagem (fração de cima pra baixo)
from bpy_extras.object_utils import world_to_camera_view

foot = world_to_camera_view(sc, co, Vector((0, 0, 0)))
json.dump({"w": RES[0], "h": RES[1], "poses": list(POSES), "ground": 1 - foot.y, "heightM": SCALE}, open(OUT + "\\piloto.json", "w"))
print("piloto ok", 1 - foot.y)
