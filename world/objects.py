import pygame
import abc
import numpy as np


class Object(abc.ABC):
    def __init__(self) -> None:
        super().__init__()

    def get_distance_to_camera(self, camera_position: np.ndarray):
        raise NotImplementedError()


class Line(Object):
    def __init__(
        self, surface: pygame.Surface, color, start_position, end_position
    ) -> None:
        super().__init__()

        self.drawable = pygame.draw.line(surface, color, start_position, end_position)

        self._start_position = start_position
        self._end_position = end_position

    def get_distance_to_camera(self, camera_position: np.ndarray) -> np.floating:
        mean_position = (
            np.array(self._start_position) + np.array(self._end_position)
        ) / 2

        return np.linalg.norm(mean_position - camera_position)


class Circle(Object):
    def __init__(self, surface: pygame.Surface, color, center, radius: float) -> None:
        super().__init__()

        self.drawable = pygame.draw.circle(surface, color, center, radius)

        self._center = center

    def get_distance_to_camera(self, camera_position: np.ndarray) -> np.floating:
        return np.linalg.norm(np.array(self._center) - camera_position)
