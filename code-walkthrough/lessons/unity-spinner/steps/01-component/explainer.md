## An empty component

A component is a C# class that derives from `MonoBehaviour`. Unity finds the special methods by name and calls them for you:

- `Awake` and `Start` once, when the object is created
- `Update` every frame
- `FixedUpdate` every physics step

> The class name must match the file name exactly, including capitals. Otherwise Unity cannot add the script to a GameObject.
