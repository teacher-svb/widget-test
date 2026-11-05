## constexpr, anonieme namespace en struct

- **`constexpr`**: een constante die gekend is bij het compileren. `Layout.h` bundelt alle posities en snelheden van de cel als `constexpr`.
- **Anonieme namespace**: alles erin is enkel zichtbaar in dit `.cpp`-bestand. Zo botsen 2 hulpfuncties met dezelfde naam in 2 verschillende bestanden niet bij het linken.
- **`struct`**: een klasse waarin alles standaard `public` is. Dat is het enige verschil met `class`.

> In C# is een `struct` een waardetype en een `class` een referentietype. In C++ niet: beide zijn waardetypes, beide kunnen methodes, constructors en overerving hebben. De demo gebruikt `struct` als conventie voor data zonder gedrag.
