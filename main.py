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


def draw_reference_grid(screen_config: ScreenConfig, camera: Camera):
    color = GRID_COLOR
    scaled_height = abs(camera.position[1]) // 100
    spacing = max(int(GRID_SPACING * scaled_height), GRID_SPACING)
    extent = max(int(GRID_EXTENT * scaled_height), GRID_EXTENT)

    base_x = (camera.position[0] // spacing) * spacing
    base_z = (camera.position[2] // spacing) * spacing

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
                pygame.draw.line(
                    screen_config.screen_display, color, tuple(s1), tuple(s2), 1
                )

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
            pygame.draw.line(
                screen_config.screen_display, color, tuple(s1), tuple(s2), 1
            )


while not exit_game:
    screen_config.reset_screen()
    mouse_screen_position = np.array(pygame.mouse.get_pos())

    for obj in objects:
        camera_position = camera.world_to_camera(obj["pos"])
        screen_position = camera.project_to_screen(
            camera_position, screen_config.screen_size
        )

        if screen_position is None:
            continue

        screen_size = obj["r"] * camera.focal_length / camera_position[2]

        pygame.draw.circle(
            screen_config.screen_display,
            obj["color"],
            tuple(screen_position),
            screen_size,
        )

    draw_reference_grid(screen_config, camera)

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
