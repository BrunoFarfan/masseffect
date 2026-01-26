import pygame
from display import screen_config


exit_game = False

TEST_SQUARE_CENTER = (0, 0)
TEST_SQUARE_SIZE = 100

while not exit_game:
    screen_config.reset_screen()

    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            exit_game = True

        elif event.type == pygame.MOUSEWHEEL:
            zoom_factor = 1.1 if event.y > 0 else 0.9

            screen_config.adjust_zoom(
                mouse_screen=pygame.mouse.get_pos(), zoom_factor=zoom_factor
            )

        elif (
            event.type == pygame.MOUSEBUTTONDOWN
            and pygame.key.get_mods() & pygame.KMOD_LCTRL
        ):
            if event.button == 1:
                mouse_position_on_pan_start = pygame.mouse.get_pos()
                screen_config.panning = True

        elif event.type == pygame.MOUSEBUTTONUP:
            if event.button == 1 and screen_config.panning:
                screen_config.panning = False

    if screen_config.panning:
        mouse_current_position = pygame.mouse.get_pos()

        screen_config.pan_camera(
            mouse_original_position=mouse_position_on_pan_start,
            mouse_current_position=mouse_current_position,
        )

        mouse_position_on_pan_start = mouse_current_position

    center_screen = screen_config._world_to_screen_coordinates(TEST_SQUARE_CENTER)
    screen_size = screen_config._world_to_screen_size(TEST_SQUARE_SIZE)

    pygame.draw.rect(
        screen_config.screen_display,
        (255, 255, 255),
        (*center_screen, screen_size, screen_size),
    )

    screen_config.update_screen()

pygame.quit()
