## undefined reference

Een fout van de **compiler** en een fout van de **linker** zien er gelijkaardig uit, maar betekenen iets anders:

- `was not declared in this scope`, `does not name a type`: **compiler**. Een ontbrekende `#include` of forward declaration.
- `undefined reference to ...`: **linker**. De declaratie is gevonden, de code niet.

Een `undefined reference` heeft bijna altijd een van deze oorzaken:

1. Het `.cpp`-bestand staat niet in `add_library`.
2. In de `.cpp` staat `void Update(float dt)` in plaats van `void SensorComponent::Update(float dt)`. Dat definieert een losse functie, en de methode blijft leeg.
3. Een methode staat gedeclareerd in de `.h`, maar is nooit geïmplementeerd.
4. Een template-body staat in een `.cpp`.
