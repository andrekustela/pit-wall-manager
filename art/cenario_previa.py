# Cenário da prévia do carro: asfalto, sol, céu e câmera 3/4 (rode no Blender).
import bpy, math
from mathutils import Vector

sc = bpy.context.scene
if "Chao" not in bpy.data.objects:
    me = bpy.data.meshes.new("Chao")
    me.from_pydata([(-20, -20, 0), (20, -20, 0), (20, 20, 0), (-20, 20, 0)], [], [(0, 1, 2, 3)])
    ch = bpy.data.objects.new("Chao", me)
    sc.collection.objects.link(ch)
    ma = bpy.data.materials.get("Asfalto") or bpy.data.materials.new("Asfalto")
    ma.use_nodes = True
    b = next(n for n in ma.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (0.05, 0.05, 0.055, 1)
    b.inputs["Roughness"].default_value = 0.9
    me.materials.append(ma)
if "Sol" not in bpy.data.objects:
    sun = bpy.data.lights.new("Sol", "SUN")
    sun.energy = 4.0
    sun.angle = math.radians(8)
    so = bpy.data.objects.new("Sol", sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(38), math.radians(-18), math.radians(-35))
w = sc.world or bpy.data.worlds.new("Mundo")
sc.world = w
w.use_nodes = True
bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs["Color"].default_value = (0.45, 0.55, 0.7, 1)
bg.inputs["Strength"].default_value = 0.9
if "Camera" not in bpy.data.objects:
    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    sc.collection.objects.link(cam)
    cam.location = (5.4, -5.0, 2.6)
    cam.rotation_euler = (Vector((0.1, 0, 0.35)) - cam.location).to_track_quat("-Z", "Y").to_euler()
sc.camera = bpy.data.objects["Camera"]

# cores só pra prévia (no jogo cada equipe pinta por cima)
def setcol(name, c):
    m = bpy.data.materials.get(name)
    if m:
        next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (*c, 1)

setcol("Pintura", (0.75, 0.02, 0.03))
setcol("Asa", (0.85, 0.85, 0.85))
