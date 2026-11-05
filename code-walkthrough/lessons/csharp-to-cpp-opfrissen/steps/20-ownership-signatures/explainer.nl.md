## Wie wordt eigenaar?

De signatuur van een functie vertelt wie eigenaar wordt:

- `std::unique_ptr<T>`: "ik neem het eigenaarschap over". De oproeper geeft het door met `std::move`.
- `T&`: "ik gebruik dit, het bestaat zeker"
- `T*`: "ik gebruik dit misschien, het kan `nullptr` zijn"

```cpp
arm.SetState(std::make_unique<IdleState>());
sensor.Subscribe(controller);
gripper.Grip(nullptr);
```
