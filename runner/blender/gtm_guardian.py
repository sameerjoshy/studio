"""Build and render the GTM Guardian: a stylised low-poly 3D hero.

Run headless:
  blender -b --python gtm_guardian.py -- --out <dir> --seconds 3 --fps 24 --samples 16

The character is authored procedurally (no third-party assets). Parts are
parented to a root empty and animated with direct keyframes, which keeps the
render deterministic and avoids skinning complexity.
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
    parser.add_argument("--seconds", type=float, default=3.0)
    parser.add_argument("--fps", type=int, default=24)
    parser.add_argument("--samples", type=int, default=16)
    parser.add_argument("--resolution", default="1280x720")
    return parser.parse_args(argv)


def material(name: str, color: tuple[float, float, float], metallic=0.0, roughness=0.45):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
    return mat


def add_cube(name, location, scale, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    return obj


def add_sphere(name, location, radius, mat, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=location, segments=24, ring_count=16)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    return obj


def add_cylinder(name, location, radius, depth, mat, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=location, rotation=rotation, vertices=16)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def parent_to(obj, root):
    obj.parent = root
    obj.matrix_parent_inverse = root.matrix_world.inverted()


def build_hero(root):
    navy = material("Navy", (0.055, 0.07, 0.20), metallic=0.15, roughness=0.42)
    teal = material("Teal", (0.035, 0.22, 0.22), metallic=0.10, roughness=0.48)
    gold = material("Gold", (0.85, 0.55, 0.12), metallic=0.9, roughness=0.28)
    skin = material("Skin", (0.78, 0.55, 0.42), roughness=0.6)
    dark = material("Dark", (0.02, 0.025, 0.05), roughness=0.5)
    glow = material("Glow", (1.0, 0.62, 0.16), metallic=0.4, roughness=0.2)
    glow.node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = (1.0, 0.55, 0.1, 1)
    glow.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 2.5

    parts = []

    # Legs and boots
    for side in (-1, 1):
        thigh = add_cylinder(f"thigh_{side}", (side * 0.12, 0, 0.62), 0.085, 0.55, navy)
        thigh.rotation_euler[1] = side * 0.03
        shin = add_cylinder(f"shin_{side}", (side * 0.14, 0, 0.28), 0.075, 0.55, navy)
        boot = add_cube(f"boot_{side}", (side * 0.14, -0.03, 0.05), (0.16, 0.28, 0.10), dark)
        parts.extend([thigh, shin, boot])

    # Torso
    torso = add_sphere("torso", (0, 0, 1.10), 0.32, navy, scale=(1.0, 0.62, 1.25))
    chest = add_cube("chest_panel", (0, -0.18, 1.22), (0.34, 0.05, 0.30), teal)
    belt = add_cylinder("belt", (0, 0, 0.88), 0.215, 0.06, dark)
    buckle = add_cube("buckle", (0, -0.20, 0.88), (0.07, 0.03, 0.05), gold)
    parts.extend([torso, chest, belt, buckle])

    # Shoulders and arms
    for side in (-1, 1):
        shoulder = add_sphere(f"shoulder_{side}", (side * 0.30, 0, 1.38), 0.11, navy)
        upper = add_cylinder(
            f"upper_arm_{side}", (side * 0.40, 0, 1.12), 0.062, 0.46, navy,
            rotation=(0, side * 0.25, 0),
        )
        forearm = add_cylinder(
            f"forearm_{side}", (side * 0.50, 0, 0.82), 0.055, 0.42, navy,
            rotation=(0, side * 0.12, 0),
        )
        hand = add_sphere(f"hand_{side}", (side * 0.55, 0, 0.60), 0.07, dark, scale=(0.8, 0.55, 1.0))
        parts.extend([shoulder, upper, forearm, hand])

    # Neck / head
    neck = add_cylinder("neck", (0, 0, 1.45), 0.075, 0.12, skin)
    head = add_sphere("head", (0, 0, 1.62), 0.16, skin, scale=(0.95, 0.95, 1.05))
    hair = add_sphere("hair", (0, 0.02, 1.72), 0.165, dark, scale=(1.0, 1.0, 0.65))
    mask = add_cube("mask", (0, -0.15, 1.64), (0.30, 0.045, 0.055), dark)
    parts.extend([neck, head, hair, mask])

    # Chest badge: gold ring + GTM text
    badge = add_cylinder("badge_ring", (0, -0.215, 1.24), 0.11, 0.025, gold, rotation=(math.radians(90), 0, 0))
    badge_inner = add_cylinder("badge_inner", (0, -0.222, 1.24), 0.085, 0.02, glow, rotation=(math.radians(90), 0, 0))
    bpy.ops.object.text_add(location=(0, -0.245, 1.24), rotation=(math.radians(90), 0, 0))
    text = bpy.context.object
    text.name = "badge_text"
    text.data.body = "GTM"
    text.data.size = 0.07
    text.data.align_x = "CENTER"
    text.data.align_y = "CENTER"
    text.data.materials.append(glow)
    parts.extend([badge, badge_inner, text])

    # Cape: a curved plane behind the body
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0.20, 0.95), rotation=(math.radians(80), 0, 0))
    cape = bpy.context.object
    cape.name = "cape"
    cape.scale = (0.62, 1.05, 1)
    cape.data.materials.append(teal)

    for obj in parts + [cape]:
        parent_to(obj, root)

    return cape


def setup_scene(args):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.engine = "CYCLES"
    bpy.context.scene.cycles.device = "CPU"
    bpy.context.scene.cycles.samples = args.samples
    bpy.context.scene.cycles.use_denoising = True

    width, height = (int(v) for v in args.resolution.lower().split("x"))
    scene = bpy.context.scene
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.fps = args.fps
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False

    scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.005, 0.01, 0.025, 1)
    background.inputs["Strength"].default_value = 0.35

    # Floor
    bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, 0))
    floor = bpy.context.object
    floor.name = "floor"
    floor.data.materials.append(material("Floor", (0.015, 0.02, 0.04), roughness=0.7))

    # Lights
    bpy.ops.object.light_add(type="AREA", location=(2.5, -3.0, 3.2))
    key = bpy.context.object
    key.data.energy = 700
    key.data.size = 2.2
    key.rotation_euler = (math.radians(55), 0, math.radians(40))

    bpy.ops.object.light_add(type="AREA", location=(-3.0, -2.0, 2.2))
    fill = bpy.context.object
    fill.data.energy = 250
    fill.data.size = 2.5
    fill.rotation_euler = (math.radians(65), 0, math.radians(-50))

    bpy.ops.object.light_add(type="AREA", location=(0.5, 2.5, 3.0))
    rim = bpy.context.object
    rim.data.energy = 450
    rim.data.size = 1.8
    rim.rotation_euler = (math.radians(120), 0, 0)

    # Camera
    bpy.ops.object.camera_add(location=(2.2, -4.6, 1.75))
    camera = bpy.context.object
    camera.data.lens = 50
    scene.camera = camera
    direction = Vector((0, 0, 1.05)) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    return camera


def animate(root, cape, camera, seconds, fps):
    frames = max(2, int(seconds * fps))

    # Root bob and slight turn
    for frame in (1, frames // 4, frames // 2, (3 * frames) // 4, frames):
        t = (frame - 1) / max(1, frames - 1)
        root.location.z = 0.02 * math.sin(t * math.pi * 2)
        root.rotation_euler.z = 0.08 * math.sin(t * math.pi * 2)
        root.keyframe_insert(data_path="location", frame=frame)
        root.keyframe_insert(data_path="rotation_euler", frame=frame)

    # Cape sway
    for frame in (1, frames // 3, (2 * frames) // 3, frames):
        t = (frame - 1) / max(1, frames - 1)
        cape.rotation_euler.x = math.radians(80) + math.radians(6) * math.sin(t * math.pi * 2)
        cape.rotation_euler.y = math.radians(4) * math.sin(t * math.pi * 4)
        cape.keyframe_insert(data_path="rotation_euler", frame=frame)

    # Camera push-in
    camera.location = (2.6, -5.2, 1.85)
    camera.keyframe_insert(data_path="location", frame=1)
    camera.location = (2.1, -4.2, 1.7)
    camera.keyframe_insert(data_path="location", frame=frames)
    direction = Vector((0, 0, 1.05)) - Vector((2.1, -4.2, 1.7))
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
    scene.render.filepath = os.path.join(args.out, "frame_")
    for frame in range(1, frames + 1):
        scene.frame_set(frame)
        scene.render.filepath = os.path.join(args.out, f"frame_{frame:04d}.png")
        bpy.ops.render.render(write_still=True)

    print(f"GUARDIAN_DONE frames={frames} out={args.out}")


if __name__ == "__main__":
    main()
