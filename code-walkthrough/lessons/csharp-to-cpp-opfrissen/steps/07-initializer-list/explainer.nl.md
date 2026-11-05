## De initializer list

```cpp
GripperComponent::GripperComponent(float strokeTime, World& world)
    : strokeTime(strokeTime), world(world) {
}
```

- Na de `:` krijgt elk veld zijn waarde, **vóór** de body loopt.
- `strokeTime(strokeTime)`: buiten de haakjes het veld, erbinnen de parameter. Dezelfde naam is geen probleem.
- Een referentieveld zoals `World& world` **moet** in de initializer list: een referentie moet bij het aanmaken naar iets wijzen, en achteraf toewijzen kan niet.

> Velden worden geïnitialiseerd in de volgorde waarin ze in de klasse **gedeclareerd** staan, niet in de volgorde van de initializer list. Ze worden vernietigd in omgekeerde volgorde.
