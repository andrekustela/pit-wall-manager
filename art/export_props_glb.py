# Safety car e guindaste em 3D de verdade (Three.js), como os carros: public/props/<nome>.glb
# uso:
#   blender -b --factory-startup --disable-autoexec <safetycar.blend> --python art/export_props_glb.py -- sc
#   blender -b --factory-startup --python art/export_props_glb.py -- crane <prop_crane.obj>
# depois comprimir: npx @gltf-transform/cli@4.1.1 meshopt public/props/<nome>.glb public/props/<nome>.glb
# Frente pra -Y no Blender (vira +Z no jogo, igual ao carro de F1), em metros, centro no meio e no chão.
# Materiais simples (cor lisa); o safety car ganha "giroflex_e"/"giroflex_d" no teto pro jogo piscar.
import bpy, sys, math
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index("--") + 1:]
NAME = args[0]
OUT = rf"C:\Users\Kustela\f1-manager\public\props\{NAME}.glb"
if NAME == "crane":
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.obj_import(filepath=args[1])
sc = bpy.context.scene
ms = [o for o in sc.objects if o.type == "MESH" and not o.hide_render and not any(c.hide_render for c in o.users_collection)]


def flat(name, col, metal=0.0, rough=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    return m


GLASS = flat("vidro", (0.03, 0.04, 0.06), 0.4, 0.08)
YELLOW = flat("amarelo", (0.95, 0.62, 0.05), 0.1, 0.4)
BLACK = flat("preto", (0.04, 0.04, 0.045), 0.0, 0.6)
cache = {}


def simple(m):
    if not m:
        return BLACK
    n = m.name.lower()
    if "glass" in n or "window" in n or "tint" in n:
        return GLASS
    if NAME == "crane":
        return YELLOW if "yellow" in n else BLACK
    if m.name in cache:
        return cache[m.name]
    col, metal, rough = (0.25, 0.25, 0.27), 0.0, 0.5
    if m.use_nodes:
        b = next((x for x in m.node_tree.nodes if x.type == "BSDF_PRINCIPLED"), None)
        if b and not b.inputs["Base Color"].is_linked:
            col = tuple(b.inputs["Base Color"].default_value[:3])
            metal = b.inputs["Metallic"].default_value
            rough = b.inputs["Roughness"].default_value
    cache[m.name] = flat("m_" + m.name[:40], col, metal, rough)
    return cache[m.name]


# tudo numa malha só, no mundo
dg = bpy.context.evaluated_depsgraph_get()
parts = []
for o in ms:
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    me.transform(o.matrix_world)
    for i, m in enumerate(me.materials):
        me.materials[i] = simple(m)
    if not me.materials:
        me.materials.append(BLACK)
    no = bpy.data.objects.new("tmp_" + o.name, me)
    sc.collection.objects.link(no)
    parts.append(no)
for o in ms:
    bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action="DESELECT")
for o in parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
ob.name = NAME
me = ob.data
pts = [v.co for v in me.vertices]

if NAME == "crane":
    # o caminhão veio girado: eixo da parte de baixo (chassi); a frente é o lado da ponta da lança
    lo_z = min(p.z for p in pts)
    hi_z = max(p.z for p in pts)
    low = [p for p in pts if p.z < lo_z + (hi_z - lo_z) * 0.25]
    cx = sum(p.x for p in low) / len(low)
    cy = sum(p.y for p in low) / len(low)
    sxx = sum((p.x - cx) ** 2 for p in low)
    syy = sum((p.y - cy) ** 2 for p in low)
    sxy = sum((p.x - cx) * (p.y - cy) for p in low)
    ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
    tip = [p for p in pts if p.z > lo_z + (hi_z - lo_z) * 0.85]
    tx = sum(p.x for p in tip) / len(tip) - cx
    ty = sum(p.y for p in tip) / len(tip) - cy
    if tx * math.cos(ang) + ty * math.sin(ang) < 0:
        ang += math.pi
    # frente (ang) pra -Y
    me.transform(Matrix.Rotation(-math.pi / 2 - ang, 4, "Z"))
    REAL_LEN = 12.0
else:
    # o safety car olha pra -Y; o modelo é maior que um carro de verdade
    REAL_LEN = 4.9
pts = [v.co for v in me.vertices]
lo = Vector([min(p[k] for p in pts) for k in range(3)])
hi = Vector([max(p[k] for p in pts) for k in range(3)])
k = REAL_LEN / (hi.y - lo.y)
me.transform(Matrix.Translation(Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))))
me.transform(Matrix.Scale(k, 4))
if NAME == "crane":
    # lança telescópica estendida: o que está acima da cabine (4,2 m) é lança e gancho; estica da frente da
    # base giratória (1,5 m) até a ponta, EXT metros pra frente (frente = -Y). A cabine e o caminhão ficam iguais
    EXT, F0, F1, HB = 3.0, 1.5, 5.5, 4.2
    for v in me.vertices:
        f = -v.co.y
        if v.co.z > HB and f > F0:
            v.co.y -= EXT * min(1.0, (f - F0) / (F1 - F0))
    me.update()
tris = sum(len(p.vertices) - 2 for p in me.polygons)
goal = 45000 if NAME == "sc" else 16000
if tris > goal:
    d = ob.modifiers.new("simplifica", "DECIMATE")
    d.ratio = goal / tris
print("prop", NAME, tris, "->", min(tris, goal), "tamanho", [round((hi[i] - lo[i]) * k, 2) for i in range(3)])

if NAME == "sc":
    # giroflex no teto: duas barrinhas (o jogo acende uma de cada vez)
    hz = (hi.z - lo.z) * k
    for side, x in (("e", 0.22), ("d", -0.22)):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, 0.25, hz + 0.035))
        b = bpy.context.active_object
        b.scale = (0.2, 0.09, 0.05)
        b.name = f"giroflex_{side}"
        b.data.materials.append(flat(f"luz_{side}", (1.0, 0.55, 0.05), 0.0, 0.3))
bpy.ops.object.select_all(action="DESELECT")
for o in sc.objects:
    if o.type == "MESH":
        o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True, export_animations=False, export_yup=True)
print("prop glb ok", NAME)
