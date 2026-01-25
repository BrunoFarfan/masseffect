from pygame import display, Surface, Rect, transform
from constants import DARK_BACKGROUND


class ScreenConfig:
    def __init__(self) -> None:
        display.set_caption("Mass Effect")

        self.physical_display = display.set_mode()

        self.virtual_display = Surface(self.physical_display.get_size())
        self.virtual_display.fill(DARK_BACKGROUND)

        self.pannig = False

        self.zoom = 1
        self.zoomed_virtual_origin = (0, 0)

        self.scaled_surface = None

    @property
    def physical_size(self) -> tuple[int, int]:
        return self.physical_display.get_size()

    @property
    def physical_size_center(self) -> tuple[int, int]:
        return tuple[int, int](self.physical_size[i] // 2 for i in range(2))

    @property
    def virtual_size(self) -> tuple[int, int]:
        return self.virtual_display.get_size()

    @property
    def virtual_size_center(self) -> tuple[int, int]:
        return tuple[int, int](self.virtual_size[i] // 2 for i in range(2))

    @property
    def view_size(self) -> tuple[int, int]:
        return tuple[int, int](
            round(self.physical_size[i] / self.zoom) for i in range(2)
        )

    def _clamp_zoomed_virtual_origin(self) -> None:
        self.zoomed_virtual_origin = tuple[float, float](
            max(
                0,
                min(
                    self.zoomed_virtual_origin[i],
                    self.virtual_size[i] - self.view_size[i],
                ),
            )
            for i in range(2)
        )

    def _virtual_to_physical_coordinates(
        self, coordinates: tuple[int, int]
    ) -> tuple[float, float]:
        return tuple[float, float](
            ((coordinates[i] - self.zoomed_virtual_origin[i]) * self.zoom)
            for i in range(2)
        )

    def _physical_to_virtual_coordinates(
        self, coordinates: tuple[int, int]
    ) -> tuple[float, float]:
        return tuple[float, float](
            ((coordinates[i] / self.zoom) + self.zoomed_virtual_origin[i])
            for i in range(2)
        )

    def adjust_camera(self):
        self._clamp_zoomed_virtual_origin()

        view_rect = Rect(*self.zoomed_virtual_origin, *self.view_size)

        sub_surface = self.virtual_display.subsurface(view_rect)
        self.scaled_surface = transform.scale(sub_surface, self.physical_size)

        self.update_physical_display()

    def pan_camera(
        self,
        mouse_original_position: tuple[int, int],
        mouse_current_position: tuple[int, int],
    ) -> None:
        zoomed_virtual_origin_mutable = list(self.zoomed_virtual_origin)
        for i in range(2):
            zoomed_virtual_origin_mutable[i] -= (
                mouse_current_position[i] - mouse_original_position[i]
            ) / self.zoom

        self.zoomed_virtual_origin = tuple[float, float](zoomed_virtual_origin_mutable)

        self.adjust_camera()

    def adjust_zoom(
        self, mouse_position: tuple[int, int], zoom_factor: float | int | None = None
    ) -> None:
        mouse_virtual = self._physical_to_virtual_coordinates(mouse_position)
        if zoom_factor is not None:
            self.zoom = max(1, self.zoom * zoom_factor)

        self.zoomed_virtual_origin = tuple[float, float](
            (mouse_virtual[i] - mouse_position[i] / self.zoom) for i in range(2)
        )

        self.adjust_camera()

    def blit(self, source) -> None:
        self.physical_display.blit(source, (0, 0))

    def update_physical_display(self):
        if self.scaled_surface is None:
            self.blit(self.virtual_display)

        else:
            self.blit(self.scaled_surface)

        display.update()


screen_config = ScreenConfig()
