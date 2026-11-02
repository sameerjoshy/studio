"""Build and render the GTM Guardian: a stylised low-poly 3D hero.

Headless:
  blender -b --python gtm_guardian.py -- --out <dir> --seconds 2 --fps 24 --samples 24

Procedural character, no third-party assets. Parts are parented to a root empty
and animated with direct keyframes; no skinning, which keeps renders deterministic.
"""

from __future__ import annotations

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--seconds", type=float, default=2.0)
    parser.add_argument("--fps", type=int, default=24)
    parser.add_argument("--samples", type=int, default=24)
    parser.add_argument("--resolution", default="1280x720")
    return parser.parse_args(argv)


def material(name, color, metallic=0.0, roughness=0.45, emission=None, strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
        if emission:
            bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
            bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def cyl_between(name, start, end, radius, mat, vertices=16):
    start_v = Vector(start)
    end_v = Vector(end)
    mid = (start_v + end_v) / 2
    length = (end_v - start_v).length
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius, depth=length, location=mid, vertices=vertices
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = (end_v - start_v).to_track_quat("Z", "Y").to_euler()
    obj.data.materials.append(mat)
    return obj


def sphere(name, location, radius, mat, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=radius, location=location, segments=28, ring_count=18
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    return obj


def cube(name, location, scale, mat, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    if bevel > 0:
        modifier = obj.modifiers.new("Bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
    return obj


def torus(name, location, major, minor, mat, rotation=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor, location=location, rotation=rotation
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    return obj


def parent_to(obj, root):
    obj.parent = root
    obj.matrix_parent_inverse = root.matrix_world.inverted()


def build_hero(root):
    navy = material("Navy", (0.035, 0.05, 0.16), metallic=0.25, roughness=0.40)
    navy_light = material("Navy Light", (0.09, 0.12, 0.28), metallic=0.20, roughness=0.42)
    teal = material("Teal", (0.02, 0.16, 0.17), metallic=0.15, roughness=0.48)
    gold = material("Gold", (0.72, 0.42, 0.08), metallic=0.95, roughness=0.24)
    skin = material("Skin", (0.72, 0.48, 0.36), roughness=0.55)
    dark = material("Dark", (0.012, 0.015, 0.035), roughness=0.45)
    glow = material(
        "Glow", (1.0, 0.55, 0.12), metallic=0.3, roughness=0.2,
        emission=(1.0, 0.45, 0.05), strength=3.0,
    )

    parts = []

    # ---- torso ----
    torso = cube("torso", (0, 0, 1.14), (0.40, 0.24, 0.58), navy, bevel=0.10)
    chest = cube("chest", (0, -0.20, 1.24), (0.30, 0.06, 0.30), teal, bevel=0.05)
    belt = torus("belt", (0, 0, 0.88), 0.215, 0.035, dark, scale=(1, 0.66, 1))
    buckle = cube("buckle", (0, -0.155, 0.88), (0.07, 0.03, 0.05), gold, bevel=0.01)
    parts.extend([torso, chest, belt, buckle])

    # ---- legs ----
    for side in (-1, 1):
        hip = sphere(f"hip_{side}", (side * 0.13, 0, 0.92), 0.105, navy_light)
        thigh = cyl_between(f"thigh_{side}", (side * 0.13, 0, 0.90), (side * 0.14, 0, 0.54), 0.085, navy)
        knee = sphere(f"knee_{side}", (side * 0.14, 0, 0.54), 0.085, navy_light)
        shin = cyl_between(f"shin_{side}", (side * 0.14, 0, 0.52), (side * 0.14, 0, 0.16), 0.072, navy)
        boot = cube(f"boot_{side}", (side * 0.14, -0.045, 0.07), (0.17, 0.30, 0.12), dark, bevel=0.03)
        parts.extend([hip, thigh, knee, shin, boot])

    # ---- arms ----
    for side in (-1, 1):
        shoulder = sphere(f"shoulder_{side}", (side * 0.32, 0, 1.38), 0.105, navy_light)
        upper = cyl_between(
            f"upper_arm_{side}", (side * 0.32, 0, 1.36), (side * 0.40, -0.01, 1.10), 0.062, navy
        )
        elbow = sphere(f"elbow_{side}", (side * 0.40, -0.01, 1.10), 0.06, navy_light)
        forearm = cyl_between(
            f"forearm_{side}", (side * 0.40, -0.01, 1.09), (side * 0.43, -0.05, 0.84), 0.052, navy
        )
        hand = sphere(f"hand_{side}", (side * 0.44, -0.06, 0.78), 0.058, dark, scale=(0.85, 0.6, 1.0))
        parts.extend([shoulder, upper, elbow, forearm, hand])

    # ---- neck and head ----
    neck = cyl_between("neck", (0, 0, 1.40), (0, 0, 1.50), 0.066, skin)
    head = sphere("head", (0, 0, 1.63), 0.165, skin, scale=(0.92, 0.88, 1.05))
    hair = sphere("hair", (0, 0.015, 1.75), 0.165, dark, scale=(1.0, 0.98, 0.58))
    fringe = sphere("fringe", (0, -0.10, 1.73), 0.12, dark, scale=(0.85, 0.45, 0.35))
    bridge = cube("mask_bridge", (0, -0.145, 1.645), (0.045, 0.02, 0.012), dark)
    left_mask = cube("mask_left", (-0.058, -0.145, 1.645), (0.065, 0.02, 0.032), dark, bevel=0.012)
    right_mask = cube("mask_right", (0.058, -0.145, 1.645), (0.065, 0.02, 0.032), dark, bevel=0.012)
    parts.extend([neck, head, hair, fringe, bridge, left_mask, right_mask])

    # ---- chest badge ----
    badge_back = cyl_between("badge_back", (0, -0.215, 1.27), (0, -0.235, 1.27), 0.085, dark)
    badge_ring = torus(
        "badge_ring", (0, -0.238, 1.27), 0.085, 0.009, gold,
        rotation=(math.radians(90), 0, 0),
    )
    bpy.ops.object.text_add(location=(0, -0.245, 1.27), rotation=(math.radians(90), 0, 0))
    text = bpy.context.object
    text.name = "badge_text"
    text.data.body = "GTM"
    text.data.size = 0.062
    text.data.align_x = "CENTER"
    text.data.align_y = "CENTER"
    text.data.extrude = 0.004
    text.data.materials.append(glow)
    parts.extend([badge_back, badge_ring, text])

    # ---- cape: curved, shoulder-mounted ----
    bpy.ops.mesh.primitive_plane_add(
        size=1, location=(0, 0.16, 1.02), rotation=(math.radians(90), 0, 0)
    )
    cape = bpy.context.object
    cape.name = "cape"
    cape.scale = (0.62, 1.18, 1)
    cape.data.materials.append(teal)

    subsurf = cape.modifiers.new("Subsurf", "SUBSURF")
    subsurf.levels = 2
    subsurf.render_levels = 2

    bend = cape.modifiers.new("Bend", "SIMPLE_DEFORM")
    bend.deform_method = "BEND"
    bend.deform_axis = "Z"
    bend.angle = math.radians(38)

    cape_collar = cyl_between("cape_collar", (-0.22, 0.14, 1.44), (0.22, 0.14, 1.44), 0.05, teal)

    for obj in parts + [cape, cape_collar]:
        parent_to(obj, root)

    return cape


def setup_scene(args):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = False  # apt Blender lacks OpenImageDenoise

    width, height = (int(v) for v in args.resolution.lower().split("x"))
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.fps = args.fps
    scene.render.image_settings.file_format = "PNG"

    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass

    scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.004, 0.008, 0.02, 1)
    background.inputs["Strength"].default_value = 0.25

    # Floor + backdrop
    bpy.ops.mesh.primitive_plane_add(size=24, location=(0, 0, 0))
    floor = bpy.context.object
    floor.name = "floor"
    floor.data.materials.append(material("Floor", (0.012, 0.015, 0.03), roughness=0.75))

    # Lights
    bpy.ops.object.light_add(type="AREA", location=(2.6, -3.2, 3.4))
    key = bpy.context.object
    key.data.energy = 850
    key.data.size = 2.4
    key.rotation_euler = (math.radians(52), 0, math.radians(38))

    bpy.ops.object.light_add(type="AREA", location=(-3.2, -2.2, 2.2))
    fill = bpy.context.object
    fill.data.energy = 320
    fill.data.size = 3.0
    fill.rotation_euler = (math.radians(66), 0, math.radians(-52))

    bpy.ops.object.light_add(type="AREA", location=(0.4, 2.8, 3.2))
    rim = bpy.context.object
    rim.data.energy = 900
    rim.data.size = 1.8
    rim.rotation_euler = (math.radians(118), 0, 0)

    # Camera: low, close hero angle
    bpy.ops.object.camera_add(location=(1.8, -3.9, 1.55))
    camera = bpy.context.object
    camera.data.lens = 58
    scene.camera = camera
    direction = Vector((0, 0, 1.08)) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    return camera


def animate(root, cape, camera, seconds, fps):
    frames = max(2, int(seconds * fps))

    for frame in (1, frames // 4, frames // 2, (3 * frames) // 4, frames):
        t = (frame - 1) / max(1, frames - 1)
        root.location.z = 0.015 * math.sin(t * math.pi * 2)
        root.rotation_euler.z = 0.05 * math.sin(t * math.pi * 2)
        root.keyframe_insert(data_path="location", frame=frame)
        root.keyframe_insert(data_path="rotation_euler", frame=frame)

    for frame in (1, frames // 3, (2 * frames) // 3, frames):
        t = (frame - 1) / max(1, frames - 1)
        cape.rotation_euler.x = math.radians(90) + math.radians(3.5) * math.sin(t * math.pi * 2)
        cape.rotation_euler.y = math.radians(2.5) * math.sin(t * math.pi * 4)
        cape.keyframe_insert(data_path="rotation_euler", frame=frame)

    camera.location = (2.0, -4.3, 1.62)
    camera.keyframe_insert(data_path="location", frame=1)
    camera.location = (1.75, -3.8, 1.53)
    camera.keyframe_insert(data_path="location", frame=frames)
    direction = Vector((0, 0, 1.08)) - Vector((1.75, -3.8, 1.53))
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    camera.keyframe_insert(data_path="rotation_euler", frame=frames)

    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = frames
    return frames


def main():
    args = parse_args()
    os.makedirs(args.out, exist_ok=True)

    camera = setup_scene(args)
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
    root = bpy.context.object
    root.name = "hero_root"

    cape = build_hero(root)
    frames = animate(root, cape, camera, args.seconds, args.fps)

    scene = bpy.context.scene
    for frame in range(1, frames + 1):
        scene.frame_set(frame)
        scene.render.filepath = os.path.join(args.out, f"frame_{frame:04d}.png")
        bpy.ops.render.render(write_still=True)

    print(f"GUARDIAN_DONE frames={frames} out={args.out}")


if __name__ == "__main__":
    main()
