## enum class in C++

`enum class Lamp { Green, Amber, Red };` schrijf je altijd met de naam ervoor: `Lamp::Red`, of in de demo `StackLight::Lamp::Red`.

Een `enum class` zet zijn namen niet in de omringende scope en zet niet stil om naar `int`. Wil je het getal toch, dan schrijf je `static_cast<int>(lamp)`.

Let op de `;` na de `}`, net als bij een klasse.
