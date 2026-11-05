## Templates en dynamic_cast

- **Template**: de compiler maakt een aparte versie per type `T` waarmee je de functie gebruikt. Daarom staat de definitie in de **header**: de compiler moet de body zien in elke `.cpp` die `GetComponent<ArmIkComponent>` oproept. Een template-body in een `.cpp` geeft `undefined reference` bij het linken.
- **[`dynamic_cast<T*>`](https://en.cppreference.com/w/cpp/language/dynamic_cast)** (nieuw): is dit object een `T`? Ja: een pointer naar dat object. Nee: `nullptr`. De C++-versie van `as` in C#. Werkt enkel op klassen met minstens één virtuele methode.
- **`const auto&`**: elk element als referentie, zonder kopie. `component` is een `unique_ptr`, dus `.get()` geeft de gewone pointer.

> `dynamic_cast` doorloopt de klassenhiërarchie at runtime en is dus trager dan een gewone oproep. Wordt een opzoeking elke frame herhaald over veel componenten, bewaar dan de pointer na de eerste keer, zoals je in Godot `GetNode` in `_Ready` oproept en niet in elke `_Process`.
