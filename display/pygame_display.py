from pygame import display
from constants import DARK_BACKGROUND


class ScreenConfig:
    def __init__(self) -> None:
        display.set_caption("Mass Effect")

        self.screen_display = display.set_mode()

        self.reset_screen()

        self.rotating = False

    @property
    def screen_size(self) -> tuple[int, int]:
        return self.screen_display.get_size()

    @property
    def screen_center(self) -> tuple[int, int]:
        return tuple[int, int](self.screen_size[i] // 2 for i in range(2))

    def reset_screen(self) -> None:
        self.screen_display.fill(DARK_BACKGROUND)

    def update_screen(self) -> None:
        display.update()


screen_config = ScreenConfig()
