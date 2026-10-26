# Render da câmera onboard (olhos do piloto) pro jogo (public/onboard).
# uso: blender -b --factory-startup --disable-autoexec <fp04rb_new_rig.blend> --python art/render_onboard.py
# Saída: base_corpo.png/base_volante.png (luz e reflexos) + mask_* (R carroceria, G asa) e info.json com
# o centro do volante e a telinha dele na imagem (o jogo escreve marcha/velocidade).
# O volante e os braços do piloto saem parados, separados (o jogo gira os dois juntos, até MAX rad);
# o braço vai sumindo perto de onde o cockpit o corta, pra o corte não aparecer quando gira.
# PWM_TEST=<pasta> grava numa pasta de teste.
import bpy, math, json, os
import numpy as np
from mathutils import Vector, Quaternion
from bpy_extras.object_utils import world_to_camera_view

OUT = r"C:\Users\Kustela\f1-manager\public\onboard"
TEST = os.environ.get("PWM_TEST")
if TEST:
    OUT = TEST
MAX = 0.85
# esmaecimento do braço no corte do cockpit (px)
FEATHER = 18
RES = (1280, 720)
sc = bpy.context.scene

for n in ("ground", "light_half_sphere", "ferrari_dashboard_screen", "bee+_logo_grey-01"):
    o = bpy.data.objects.get(n)
    if o:
        o.hide_render = True
for c in bpy.data.collections:
    # sem o capacete: a câmera está nos olhos do piloto
    if "Widgets" in c.name or c.name in ("simple_scene", "helmet"):
        c.hide_render = True
for o in bpy.data.objects:
    if o.type == "LIGHT":
        o.hide_render = True
    # do piloto só sobra o corpo com os braços (o resto do corpo fica atrás do cockpit)
    if o.name in ("shoes.r", "shoes.l", "helmet", "seatbelt_mechanism.001", "seatbelts_new_driver") or o.name.startswith("WGT"):
        o.hide_render = True


def visible(o):
    return not o.hide_render and not any(c.hide_render for c in o.users_collection)


vis = [o for o in sc.objects if o.type == "MESH" and visible(o)]
ARMS = {"racer"}
WHEEL = {o.name for o in vis if "steering_wheel" in o.name or "paddle" in o.name} | ARMS
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


def transparent(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    t = nt.nodes.new("ShaderNodeBsdfTransparent")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(t.outputs[0], out.inputs[0])
    return m


PAINT = principled("pwm_pintura", (0.82, 0.82, 0.82), 0.15, 0.28, 0.7)
DARK = principled("pwm_preto", (0.03, 0.03, 0.03), 0.0, 0.5)
NONE = transparent("pwm_some")
SUIT_MATS = {"blacklather"}
HEAD_MATS = {"helmet", "glass", "metal"}
# (macacão e luva são o mesmo material no modelo: o braço todo fica escuro, sem a cor da equipe)
SUIT = principled("pwm_macacao", (0.06, 0.06, 0.07), 0.0, 0.65)

# interior do cockpit: a carroceria dentro do buraco do piloto fica preta
body = bpy.data.objects["body_object"]
# dentro das proteções de carbono do cockpit e abaixo delas (o preto começa onde o carbono acaba)
pad = bpy.data.objects["cockpit_inner"]
pw = [pad.matrix_world @ Vector(c) for c in pad.bound_box]
px0, px1 = min(p.x for p in pw), max(p.x for p in pw)
py0, py1 = min(p.y for p in pw), max(p.y for p in pw)
pz = min(p.z for p in pw) + 0.07


def cockpit(m, dark):
    """troca a cor do material (pintura ou molde) por `dark` dentro do buraco, pixel a pixel (borda lisa)"""
    nt = m.node_tree
    sh = next(n for n in nt.nodes if n.type in ("BSDF_PRINCIPLED", "EMISSION"))
    sock = sh.inputs["Base Color"] if sh.type == "BSDF_PRINCIPLED" else sh.inputs[0]
    pos = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(pos.outputs["Position"], sep.inputs[0])
    fac = None
    for axis, op, v in (("X", "GREATER_THAN", px0), ("X", "LESS_THAN", px1), ("Y", "GREATER_THAN", py0 - 0.1), ("Y", "LESS_THAN", py1 + 0.05), ("Z", "LESS_THAN", pz)):
        c = nt.nodes.new("ShaderNodeMath")
        c.operation = op
        nt.links.new(sep.outputs[axis], c.inputs[0])
        c.inputs[1].default_value = v
        if fac is None:
            fac = c
        else:
            mul = nt.nodes.new("ShaderNodeMath")
            mul.operation = "MULTIPLY"
            nt.links.new(fac.outputs[0], mul.inputs[0])
            nt.links.new(c.outputs[0], mul.inputs[1])
            fac = mul
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(fac.outputs[0], mix.inputs["Factor"])
    mix.inputs[6].default_value = (*sock.default_value[:3], 1)
    mix.inputs[7].default_value = (*dark, 1)
    nt.links.new(mix.outputs[2], sock)
    # sem verniz e metal no buraco (refletia o céu e ficava cinza claro)
    if sh.type == "BSDF_PRINCIPLED":
        for name in ("Coat Weight", "Metallic"):
            if name in sh.inputs:
                k = nt.nodes.new("ShaderNodeMath")
                k.operation = "MULTIPLY_ADD"
                nt.links.new(fac.outputs[0], k.inputs[0])
                k.inputs[1].default_value = -sh.inputs[name].default_value
                k.inputs[2].default_value = sh.inputs[name].default_value
                nt.links.new(k.outputs[0], sh.inputs[name])
    return m


# (o buraco leva a cor do carro também, só que bem mais escura e fosca)
BODY_PAINT = cockpit(principled("pwm_pintura_corpo", (0.82, 0.82, 0.82), 0.15, 0.28, 0.7), (0.16, 0.16, 0.16))


def setall(o, m):
    if not o.data.materials:
        o.data.materials.append(m)
    for i in range(len(o.data.materials)):
        o.data.materials[i] = m


for o in vis:
    for i, m in enumerate(o.data.materials):
        if m and ("sticker" in m.name or "dashboard" in m.name or "display_screen" in m.name):
            o.data.materials[i] = DARK
        elif m and o.name in ARMS and m.name in HEAD_MATS:
            o.data.materials[i] = NONE
        elif m and o.name in ARMS and m.name in SUIT_MATS:
            o.data.materials[i] = SUIT
    if o.name in BODY | WING:
        setall(o, BODY_PAINT if o.name == body.name else PAINT)

# volante: osso do esqueleto (as mãos seguem por IK)
sw = bpy.data.objects["steering_and_drs"].pose.bones["steering_wheel"]
sw.rotation_mode = "QUATERNION"
dl = bpy.context.view_layer


def steer(a):
    sw.rotation_quaternion = Quaternion((0, 1, 0), a)
    dl.update()


def proj(names):
    pts = []
    for n in names:
        o = bpy.data.objects[n]
        ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
        for c in o.bound_box:
            v = world_to_camera_view(sc, co, ev.matrix_world @ Vector(c))
            pts.append((v.x, 1 - v.y))
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return [min(xs), min(ys), max(xs), max(ys)]


# sentido: positivo = horário na tela (o LED do alto vai pra direita)
TOP = next(n for n in WHEEL if "top_leds" in n)
steer(0)
x0 = sum(proj([TOP])[0::2]) / 2
steer(0.3)
SIGN = 1 if sum(proj([TOP])[0::2]) / 2 > x0 else -1
steer(0)
wheel_box = proj(sorted(WHEEL - ARMS))
disp = [n for n in WHEEL if "display_glass" in n]
disp_box = proj(disp) if disp else wheel_box

# cantos da telinha (sup. esq., sup. dir., inf. esq.) em cada pose: o jogo encaixa marcha/velocidade nela
glass = bpy.data.objects[disp[0]]
bb = [Vector(c) for c in glass.bound_box]
thin = min(range(3), key=lambda k: max(c[k] for c in bb) - min(c[k] for c in bb))
face = [c for c in bb if c[thin] == min(c[thin] for c in bb)]


def screen(c):
    ev = glass.evaluated_get(bpy.context.evaluated_depsgraph_get())
    v = world_to_camera_view(sc, co, ev.matrix_world @ c)
    return [v.x, 1 - v.y]


pts = sorted(face, key=lambda c: sum(screen(c)))
tl, br = pts[0], pts[-1]
tr, bl = sorted(pts[1:3], key=lambda c: -screen(c)[0])
QUAD = (tl, tr, bl)


def layer(tag):
    for o in vis:
        if tag == "corpo":
            o.hide_render = o.name in WHEEL
            o.is_holdout = False
        elif tag == "volante":
            o.hide_render = o.name in ARMS
            o.is_holdout = o.name not in WHEEL
        else:
            # só os braços (o jogo desenha por cima do volante): volante e cockpit recortam o que fica atrás deles
            o.hide_render = False
            o.is_holdout = o.name not in ARMS


def render(path):
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def load(path):
    im = bpy.data.images.load(path)
    a = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    a = a.reshape(im.size[1], im.size[0], 4)[::-1].copy()  # de cima pra baixo
    bpy.data.images.remove(im)
    os.remove(path)
    return a


def save(a, path, fmt="WEBP"):
    h, w = a.shape[:2]
    im = bpy.data.images.new("folha", w, h, alpha=True)
    im.pixels.foreach_set(a[::-1].ravel())
    im.filepath_raw = path
    im.file_format = fmt
    if fmt == "WEBP":
        im.save(quality=90)
    else:
        im.save()
    bpy.data.images.remove(im)


def crop_of(frames):
    alpha = np.max([f[..., 3] for f in frames], axis=0)
    ys, xs = np.nonzero(alpha > 0.004)
    return [int(xs.min()), int(ys.min()), int(xs.max()) + 1 - int(xs.min()), int(ys.max()) + 1 - int(ys.min())]


def cut(f, c):
    return f[c[1]:c[1] + c[3], c[0]:c[0] + c[2]]


layer("corpo")
render(OUT + "\\base_corpo.png")
# volante parado (o jogo gira)
steer(0)
layer("volante")
render(OUT + "\\_v.png")
wheel = load(OUT + "\\_v.png")
WCROP = crop_of([wheel])
save(cut(wheel, WCROP), OUT + "\\base_volante.png", "PNG")
quad = [screen(c) for c in QUAD]
# braços: com o cockpit na frente (como aparece) e sem (pra achar onde ele corta o braço)
layer("bracos")
render(OUT + "\\_b.png")
arms = load(OUT + "\\_b.png")
for o in vis:
    # sem o cockpit (o volante continua recortando): a diferença é só o corte do cockpit
    o.hide_render = o.name not in WHEEL
    o.is_holdout = o.name in WHEEL and o.name not in ARMS
render(OUT + "\\_bf.png")
full = load(OUT + "\\_bf.png")
cutm = (full[..., 3] > 0.5) & (arms[..., 3] < 0.05)
# peso 0 no corte subindo até 1 a FEATHER px dele (crescendo a região do corte um px por vez)
w = np.ones(cutm.shape, np.float32)
w[cutm] = 0.0
reach = cutm.copy()
for k in range(1, FEATHER + 1):
    grown = reach.copy()
    grown[1:] |= reach[:-1]
    grown[:-1] |= reach[1:]
    grown[:, 1:] |= reach[:, :-1]
    grown[:, :-1] |= reach[:, 1:]
    w[grown & ~reach] = k / FEATHER
    reach = grown
arms[..., 3] *= w
ACROP = crop_of([arms])
save(cut(arms, ACROP), OUT + "\\base_bracos.png", "PNG")

if not TEST:
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
        if o.name in ARMS:
            for i, m in enumerate(o.data.materials):
                if m is not NONE:
                    o.data.materials[i] = E0
        else:
            setall(o, ER if o.name in BODY else EG if o.name in WING else E0)
    layer("corpo")
    render(OUT + "\\mask_corpo.png")
    layer("volante")
    render(OUT + "\\_m.png")
    save(cut(load(OUT + "\\_m.png"), WCROP), OUT + "\\mask_volante.png", "PNG")

json.dump({"w": RES[0], "h": RES[1], "wheel": wheel_box, "display": disp_box, "wheelCrop": WCROP, "quad": quad, "max": MAX, "armsCrop": ACROP}, open(OUT + "\\info.json", "w"))
print("onboard ok", SIGN, WCROP, ACROP)
