## Frame rate independent

Multiplying by `Time.deltaTime` turns "per frame" into "per second":

```csharp
transform.Rotate(axis, degreesPerSecond * Time.deltaTime);
```

At 30 fps `deltaTime` is about 0.033, at 144 fps about 0.007. The object now turns the same amount every second on every machine.

### Public or SerializeField?

`[SerializeField] private` gives you the Inspector field without letting any other script change the value. Prefer it over `public` unless another script really needs access.
