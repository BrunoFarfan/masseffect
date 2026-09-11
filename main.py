import pygame
from display import screen_config, camera
import numpy as np

from display.pygame_display import ScreenConfig
from display.camera import Camera
from constants import GRID_COLOR, GRID_EXTENT, GRID_SPACING

exit_game = False
SENSIBILITY = 0.005
SPEED = 0.05

objects = [
    {"pos": np.array((0, 0, 0)), "r": 1, "color": (255, 255, 255)},
    {"pos": np.array((3, 0, 5)), "r": 1, "color": (255, 0, 0)},
    {"pos": np.array((-3, 1, 8)), "r": 1.5, "color": (0, 255, 0)},
]


def create_reference_grid(screen_config: ScreenConfig, camera: Camera):
    """Create a reference grid at y = 0.

    Returns a grid of lines that can be later drawn to the screen.
    """
    scaled_height = abs(camera.position[1]) // 100
    spacing = max(int(GRID_SPACING * scaled_height), GRID_SPACING)
    extent = max(int(GRID_EXTENT * scaled_height), GRID_EXTENT)

    base_x = (camera.position[0] // spacing) * spacing
    base_z = (camera.position[2] // spacing) * spacing

    grid_lines = []
    for x in range(-extent, extent + 1, spacing):
        p1 = np.array((base_x + x, 0, base_z - extent))
        p2 = np.array((base_x + x, 0, base_z + extent))

        c1 = camera.world_to_camera(p1)
        c2 = camera.world_to_camera(p2)

        if camera.is_point_visible(c1) or camera.is_point_visible(c2):
            c1, c2 = camera.clip_to_near_plane(c1, c2)
            s1 = camera.project_to_screen(c1, screen_config.screen_size)
            s2 = camera.project_to_screen(c2, screen_config.screen_size)

            if s1 is not None and s2 is not None:
                grid_lines.append((tuple(s1), tuple(s2)))

    for z in range(-extent, extent + 1, spacing):
        p1 = np.array((base_x - extent, 0, base_z + z))
        p2 = np.array((base_x + extent, 0, base_z + z))

        c1 = camera.world_to_camera(p1)
        c2 = camera.world_to_camera(p2)

        if camera.is_point_visible(c1) or camera.is_point_visible(c2):
            c1, c2 = camera.clip_to_near_plane(c1, c2)
            s1 = camera.project_to_screen(c1, screen_config.screen_size)
            s2 = camera.project_to_screen(c2, screen_config.screen_size)

            if s1 is not None and s2 is not None:
                grid_lines.append((tuple(s1), tuple(s2)))

    return grid_lines


def sort_bodies_for_display(objects: list, camera_position: np.ndarray) -> list:
    return sorted(
        objects, key=lambda x: np.linalg.norm(x["pos"] - camera_position), reverse=True
    )


def display_objects_with_grid_lines(
    objects: list, grid_lines: list, camera_position: np.ndarray
):
    above_objects = [obj for obj in objects if obj["pos"][1] >= 0]
    below_objects = [obj for obj in objects if obj["pos"][1] < 0]

    above_objects = sort_bodies_for_display(above_objects, camera_position)
    above_objects = [[obj, "circle"] for obj in above_objects]

    below_objects = sort_bodies_for_display(below_objects, camera_position)
    below_objects = [[obj, "circle"] for obj in below_objects]

    grid_lines = [[grid_line, "line"] for grid_line in grid_lines]

    camera_above = camera.position[1] >= 0

    if camera_above:
        all_objects = below_objects + grid_lines + above_objects
    else:
        all_objects = above_objects + grid_lines + below_objects

    return all_objects


while not exit_game:
    screen_config.reset_screen()
    mouse_screen_position = np.array(pygame.mouse.get_pos())

    grid_lines = create_reference_grid(screen_config, camera)

    all_objects = display_objects_with_grid_lines(objects, grid_lines, camera.position)

    for obj, obj_type in all_objects:
        if obj_type == "circle":
            camera_position = camera.world_to_camera(obj["pos"])
            screen_position = camera.project_to_screen(
                camera_position, screen_config.screen_size
            )

            if screen_position is None:
                continue

            screen_size_radius = obj["r"] * camera.focal_length / camera_position[2]

            pygame.draw.circle(
                screen_config.screen_display,
                obj["color"],
                tuple(screen_position),
                screen_size_radius,
            )
        elif obj_type == "line":
            pygame.draw.line(screen_config.screen_display, GRID_COLOR, obj[0], obj[1])

    for event in pygame.event.get():
        keys = pygame.key.get_pressed()

        if event.type == pygame.QUIT:
            exit_game = True

        elif (
            event.type == pygame.MOUSEBUTTONDOWN
            and pygame.key.get_mods() & pygame.KMOD_LCTRL
        ):
            if event.button == 1:
                mouse_rotation_start_position = mouse_screen_position.copy()
                screen_config.rotating = True

        if keys[pygame.K_w]:
            camera.position += camera.forward_direction * SPEED

        if keys[pygame.K_s]:
            camera.position -= camera.forward_direction * SPEED

        if keys[pygame.K_a]:
            camera.position -= camera.right_direction * SPEED

        if keys[pygame.K_d]:
            camera.position += camera.right_direction * SPEED

        if keys[pygame.K_e]:
            camera.position += camera.up_direction * SPEED

        if keys[pygame.K_q]:
            camera.position -= camera.up_direction * SPEED

        elif event.type == pygame.MOUSEBUTTONUP:
            if event.button == 1 and screen_config.rotating:
                screen_config.rotating = False

    if screen_config.rotating:
        dx, dy = mouse_screen_position - mouse_rotation_start_position

        camera.yaw -= dx * SENSIBILITY
        camera.pitch -= dy * SENSIBILITY
        camera.pitch = max(min(np.pi / 2, camera.pitch), -np.pi / 2)

        mouse_rotation_start_position = mouse_screen_position.copy()

    screen_config.update_screen()

pygame.quit()
