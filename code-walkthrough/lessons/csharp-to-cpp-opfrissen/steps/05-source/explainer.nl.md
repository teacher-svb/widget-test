## De implementatie in de .cpp

- De `.cpp` include zijn eigen header als eerste.
- Elke methode krijgt de klassenaam ervoor: `GripperComponent::Update`. Vergeet je die, dan definieer je een losse functie `Update`, en blijft de methode zonder code.
- `override` en `virtual` staan enkel in de header, niet meer in de `.cpp`. `const` staat in beide.

Hier roepen we `world.FindCrateNear(...)` op. Daarvoor moet de compiler de inhoud van `World` kennen, dus include de `.cpp` `World.h`.

> **Vuistregel**: forward declareer in de header wat kan, include in de `.cpp` wat je gebruikt.
