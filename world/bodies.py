import numpy as np


class Body:
    def __init__(
        self, position: np.ndarray, velocity: np.ndarray, mass: float, radius: float
    ) -> None:
        self.position = position
        self.velocity = velocity
        self.mass = mass
        self.radius = radius

