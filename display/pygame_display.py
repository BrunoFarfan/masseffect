import numpy as np
from pygame import display, Rect, font
from constants import DARK_BACKGROUND, COLOR_WHITE


class ScreenConfig:
    def __init__(self) -> None:
        display.set_caption("Mass Effect")
        font.init()
        self.font = font.SysFont("Arial", 15)

        self.screen_display = display.set_mode()

        self.panning = False

        self.zoom = 1
        self.view_window_world_origin = (0, 0)

        self.scaled_surface = None

        self.reset_screen()

    @property
    def screen_size(self) -> tuple[int, int]:
        return self.screen_display.get_size()

    @property
    def screen_size_center(self) -> tuple[int, int]:
        return tuple[int, int](self.screen_size[i] // 2 for i in range(2))

    @property
    def view_window(self) -> Rect:
        return Rect(
            self.view_window_world_origin[0],
            self.view_window_world_origin[1],
            self.screen_size[0] / self.zoom,
            self.screen_size[1] / self.zoom,
        )

    def _world_to_screen_coordinates(
        self, coordinates: tuple[float, float] | np.ndarray
    ) -> tuple[float, float]:
        return (
            (coordinates[0] - self.view_window_world_origin[0]) * self.zoom,
            (
                self.view_window_world_origin[1]
                + self.view_window.height
                - coordinates[1]
            )
            * self.zoom,
        )

    def _screen_to_world_coordinates(
        self, coordinates: tuple[int, int]
    ) -> tuple[float, float]:
        return (
            coordinates[0] / self.zoom + self.view_window_world_origin[0],
            self.view_window_world_origin[1]
            + self.view_window.height
            - coordinates[1] / self.zoom,
        )

    def _world_to_screen_size(self, size: float) -> float:
        return size * self.zoom

    def pan_camera(
        self,
        mouse_original_position: tuple[int, int],
        mouse_current_position: tuple[int, int],
    ) -> None:
        dx = (mouse_current_position[0] - mouse_original_position[0]) / self.zoom
        dy = (mouse_current_position[1] - mouse_original_position[1]) / self.zoom

        self.view_window_world_origin = (
            self.view_window_world_origin[0] - dx,
            self.view_window_world_origin[1] + dy,
        )

    def adjust_zoom(
        self, mouse_screen: tuple[int, int], zoom_factor: float | int | None = None
    ) -> None:
        mouse_world = self._screen_to_world_coordinates(mouse_screen)

        if zoom_factor is not None:
            self.zoom *= zoom_factor

        self.view_window_world_origin = (
            mouse_world[0] - mouse_screen[0] / self.zoom,
            mouse_world[1] - self.view_window.height + mouse_screen[1] / self.zoom,
        )

    def print_zoom(self):
        zoom_text = self.font.render(
            f"Zoom: {round(self.zoom * 100, 2)}%", True, COLOR_WHITE
        )
        self.screen_display.blit(zoom_text, (0, 0))

    def print_mouse_world_coordinates(self, screen_coordinates: tuple[int, int]):
        world_coordinates = self._screen_to_world_coordinates(screen_coordinates)
        world_coordinates = (
            round(world_coordinates[0], 1),
            round(world_coordinates[1], 1),
        )
        coordinates_label_text = self.font.render(
            "Mouse world position:", True, COLOR_WHITE
        )
        coordinates_text_position = (
            self.screen_display.get_size()[0] - coordinates_label_text.get_size()[0],
            0,
        )

        self.screen_display.blit(coordinates_label_text, coordinates_text_position)

        coordinates_text = self.font.render(f"{world_coordinates}", True, COLOR_WHITE)
        coordinates_text_position = (
            self.screen_display.get_size()[0] - coordinates_text.get_size()[0],
            coordinates_label_text.get_size()[1],
        )

        self.screen_display.blit(coordinates_text, coordinates_text_position)

    def reset_screen(self) -> None:
        self.screen_display.fill(DARK_BACKGROUND)
        self.print_zoom()

    def update_screen(self) -> None:
        display.update()


screen_config = ScreenConfig()
