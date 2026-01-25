import pygame
from display import screen_config


exit_game = False

while not exit_game:
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            exit_game = True

        elif event.type == pygame.MOUSEWHEEL:
            zoom_factor = 1.1 if event.y > 0 else 0.9

            screen_config.adjust_zoom(
                mouse_position=pygame.mouse.get_pos(), zoom_factor=zoom_factor
            )

        elif (
            event.type == pygame.MOUSEBUTTONDOWN
            and pygame.key.get_mods() & pygame.KMOD_LCTRL
        ):
            if event.button == 1:
                mouse_position_on_pan_start = pygame.mouse.get_pos()
                screen_config.pannig = True

        elif event.type == pygame.MOUSEBUTTONUP:
            if event.button == 1 and screen_config.pannig:
                screen_config.pannig = False

    if screen_config.pannig:
        mouse_current_position = pygame.mouse.get_pos()

        screen_config.pan_camera(
            mouse_original_position=mouse_position_on_pan_start,
            mouse_current_position=mouse_current_position,
        )

        mouse_position_on_pan_start = mouse_current_position

    pygame.draw.rect(
        screen_config.virtual_display,
        (255, 255, 255),
        (*screen_config.virtual_size_center, 1, 1),
    )

    screen_config.update_physical_display()

pygame.quit()
