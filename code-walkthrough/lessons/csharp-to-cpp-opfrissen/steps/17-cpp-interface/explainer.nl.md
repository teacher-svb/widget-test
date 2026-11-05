## Interfaces in C++

C++ kent geen `interface`. Een abstracte klasse met enkel **pure virtual** methodes (`= 0`) speelt die rol.

- Eén `= 0` maakt een klasse abstract: je kan ze niet instantiëren.
- Meerdere interfaces overerven is veilig, want ze hebben geen velden en dus geen diamond-probleem.
- Elke basisklasse krijgt haar eigen `public`.

Een interface mag ook lege bodies `{}` geven in plaats van `= 0`. Dan overschrijft een listener enkel wat hij nodig heeft, vergelijkbaar met default interface methods in C#. Het nadeel: vergeet je een methode te overschrijven, dan zegt de compiler niets.
