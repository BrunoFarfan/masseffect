import numpy as np
from constants import FOCAL_LENGTH, NEAR_PLANE


class Camera:
    def __init__(
        self,
        position: tuple[float, float, float] = (0, 0, -10),
        yaw: float = 0,
        pitch: float = 0,
        focal_length: float = FOCAL_LENGTH,
    ) -> None:
        self.position = np.array(position, dtype=float)
        self.yaw = yaw
        self.pitch = pitch
        self.focal_length = focal_length

    @property
    def forward_direction(self):
        direction = np.array(
            [
                np.sin(self.yaw) * np.cos(self.pitch),
                np.sin(self.pitch),
                np.cos(self.yaw) * np.cos(self.pitch),
            ]
        )

        return direction / np.linalg.norm(direction)

    @property
    def right_direction(self):
        right_vector = np.cross(self.forward_direction, [0, 1, 0])
        return right_vector / np.linalg.norm(right_vector)

    @property
    def up_direction(self):
        up_vector = np.cross(self.right_direction, self.forward_direction)
        return up_vector / np.linalg.norm(up_vector)

    def is_point_visible(self, coordinates: np.ndarray) -> bool:
        return coordinates[2] > 0

    def world_to_camera(self, coordinates: np.ndarray) -> np.ndarray:
        translated = coordinates - self.position

        view_matrix = np.array(
            [
                self.right_direction,
                self.up_direction,
                self.forward_direction,
            ]
        )

        return view_matrix @ translated

    def project_to_screen(
        self, coordinates: np.ndarray, screen_size: tuple[int, int]
    ) -> np.ndarray | None:
        x, y, z = coordinates
        if not self.is_point_visible(coordinates):
            return None

        screen_x = (x / z) * self.focal_length + screen_size[0] / 2
        screen_y = (-y / z) * self.focal_length + screen_size[1] / 2

        return np.array((screen_x, screen_y))

    def world_to_screen(
        self, coordinates: np.ndarray, screen_size: tuple[int, int]
    ) -> np.ndarray | None:
        camera_coordinates = self.world_to_camera(coordinates)
        return self.project_to_screen(camera_coordinates, screen_size)

    def clip_to_near_plane(
        self, point_one: np.ndarray, point_two: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray]:
        if point_one[2] >= NEAR_PLANE and point_two[2] >= NEAR_PLANE:
            return point_one, point_two

        t = (NEAR_PLANE - point_one[2]) / (point_two[2] - point_one[2])

        clipped_point = point_one + t * (point_two - point_one)

        if point_one[2] < NEAR_PLANE:
            return point_one, clipped_point
        else:
            return clipped_point, point_two


camera = Camera()
