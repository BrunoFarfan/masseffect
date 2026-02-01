import numpy as np


class Camera:
    def __init__(
        self,
        position: tuple[float, float, float],
        yaw: float = 0,
        pitch: float = 0,
        zoom: float = 1,
    ) -> None:
        self.position = np.array(position)
        self.yaw = yaw
        self.pitch = pitch
        self.zoom = zoom

    def world_to_camera(self, coordinates: np.ndarray) -> np.ndarray:
        translated_coordinates = coordinates - self.position

        inverse_rotation_y = np.array(
            [
                [np.cos(self.yaw), 0, np.sin(self.yaw)],
                [0, 1, 0],
                [-np.sin(self.yaw), 0, np.cos(self.yaw)],
            ]
        )

        inverse_rotation_x = np.array(
            [
                [1, 0, 0],
                [0, np.cos(self.pitch), -np.sin(self.pitch)],
                [0, np.sin(self.pitch), np.cos(self.pitch)],
            ]
        )

        return inverse_rotation_x @ inverse_rotation_y @ translated_coordinates

    def project_to_screen(
        self, coordinates: np.ndarray, screen_size: tuple[int, int]
    ) -> np.ndarray | None:
        x, y, z = coordinates
        if z <= 0:
            return None  # behind camera

        screen_x = (x / z) * self.zoom + screen_size[0] / 2
        screen_y = (-y / z) * self.zoom + screen_size[1] / 2

        return np.array((screen_x, screen_y))

    def world_to_screen(
        self, coordinates: np.ndarray, screen_size: tuple[int, int]
    ) -> np.ndarray | None:
        camera_coordinates = self.world_to_camera(coordinates)
        return self.project_to_screen(camera_coordinates, screen_size)
