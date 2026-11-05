## const methodes en beginwaarden

- **`const` methode**: `IsClosed() const` belooft dat de methode het object niet wijzigt. Op een `const` object, of via een `const`-referentie, roep je enkel `const` methodes op. De `const` staat in de header **en** in de `.cpp`.
- **Default member initializer** in de header: `Crate* held = nullptr;` en `float opening = 1.0f;`. Zonder krijgt een pointer een willekeurige waarde, niet `nullptr`.

```cpp
private:
    float opening = 1.0f;
    Crate* held = nullptr;
```
