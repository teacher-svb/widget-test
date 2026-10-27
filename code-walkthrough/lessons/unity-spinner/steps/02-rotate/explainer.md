## Rotate every frame

`transform.Rotate(x, y, z)` adds a rotation in degrees to the object's current rotation.

This version has a bug that is easy to miss: it rotates `speed` degrees **per frame**.

With `speed = 90` the object turns 2700 degrees per second at 30 fps, and 12960 degrees per second at 144 fps. The game feels different on every machine.
