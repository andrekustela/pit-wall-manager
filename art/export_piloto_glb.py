# Piloto 3D (com esqueleto) pro pódio em Three.js: public/piloto/piloto.glb
# uso: blender -b --factory-startup --disable-autoexec <fp04rb_new_rig.blend> --python art/export_piloto_glb.py
# depois comprimir: npx @gltf-transform/cli@4.1.1 meshopt public/piloto/piloto.glb public/piloto/piloto.glb
# Todos os ossos (com só os DEF os sapatos e o capacete, presos em outros ossos, ficavam de fora); pose zerada = em pé. Materiais com nomes fixos pro jogo pintar:
# macacao, faixa, casco (capacete), viseira, preto.
import bpy
from mathutils import Matrix

OUT = r"C:\Users\Kustela\f1-manager\public\piloto\piloto.glb"
sc = bpy.context.scene
rig = bpy.data.objects["rig"]
rig.parent = None
rig.matrix_world = Matrix()
for n in ("thigh_parent.L", "thigh_parent.R", "upper_arm_parent.L", "upper_arm_parent.R"):
    rig.pose.bones[n]["IK_FK"] = 1.0
for b in rig.pose.bones:
    b.location = (0, 0, 0)
    b.rotation_quaternion = (1, 0, 0, 0)
    b.rotation_euler = (0, 0, 0)
    b.scale = (1, 1, 1)
    for c in b.constraints:
        if getattr(c, "target", None) and c.target != rig:
            c.mute = True
bpy.context.view_layer.update()


def principled(name, col, metal, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    return m


MAT = {
    "macacao": principled("macacao", (0.8, 0.8, 0.8), 0.0, 0.6),
    "faixa": principled("faixa", (0.85, 0.85, 0.85), 0.0, 0.5),
    "casco": principled("casco", (0.85, 0.85, 0.85), 0.1, 0.25),
    "viseira": principled("viseira", (0.02, 0.02, 0.03), 0.6, 0.08),
    "preto": principled("preto", (0.05, 0.05, 0.055), 0.0, 0.6),
}
keep = [bpy.data.objects[n] for n in ("racer", "shoes.r", "shoes.l", "helmet")] + list(bpy.data.collections["helmet"].all_objects)
for o in keep:
    if o.type != "MESH":
        continue
    for i, m in enumerate(o.data.materials):
        n = m.name.lower() if m else ""
        o.data.materials[i] = (
            MAT["macacao"] if n == "blacklather" else MAT["faixa"] if n == "leather2" else MAT["casco"] if n in ("audi_white", "helmet") or "white" in n
            else MAT["viseira"] if ("vizor" in o.name or "polycarbonate" in n or "glass" in n) else MAT["preto"]
        )
# capacete e sapatos detalhados pesam demais (22 MB): no pódio aparecem pequenos, dá pra simplificar bem
for o in list(bpy.data.collections["helmet"].all_objects) + [bpy.data.objects["shoes.r"], bpy.data.objects["shoes.l"]]:
    if o.type != "MESH":
        continue
    # sem subdivisão (era ela que inchava) e, se ainda for pesado, simplifica
    for md in [md for md in o.modifiers if md.type == "SUBSURF"]:
        o.modifiers.remove(md)
    if len(o.data.polygons) > 3000:
        d = o.modifiers.new("simplifica", "DECIMATE")
        d.ratio = 3000 / len(o.data.polygons)
bpy.ops.object.select_all(action="DESELECT")
for o in keep + [rig]:
    o.hide_set(False)
    o.hide_viewport = False
    o.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_def_bones=False,
    export_animations=False,
    export_apply=True,
    export_yup=True,
)
print("glb ok")
