from pygame import display
from constants import DARK_BACKGROUND


class ScreenConfig:
    def __init__(self) -> None:
        display.set_caption("Mass Effect")

        self.screen_display = display.set_mode()

        self.reset_screen()

    @property
    def screen_size(self) -> tuple[int, int]:
        return self.screen_display.get_size()

    @property
    def screen_size_center(self) -> tuple[int, int]:
        return tuple[int, int](self.screen_size[i] // 2 for i in range(2))

    def _world_to_screen_size(self, size: float, z_camera_coordinate: float) -> float:
        return size / z_camera_coordinate

    def reset_screen(self) -> None:
        self.screen_display.fill(DARK_BACKGROUND)

    def update_screen(self) -> None:
        display.update()


screen_config = ScreenConfig()
