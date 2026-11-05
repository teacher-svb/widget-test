## Een test in Catch2

De tests gebruiken [Catch2 v3](https://github.com/catchorg/Catch2), zoals in het vak C++ Programming.

- `TEST_CASE("beschrijving", "[tag]")`: de naam is gewone tekst, tags staan tussen `[]`.
- `REQUIRE(...)` stopt de test bij de eerste fout, zoals `Assert` in MSTest. `CHECK(...)` gaat verder en rapporteert alle fouten.
- Je schrijft gewoon de vergelijking: `REQUIRE(a == b)`. Catch2 toont bij een fout beide waarden.

Net als in blok 1 en 2 gebruiken de tests enkel de publieke methodes van `Cell`. Ze beschrijven **wat** de cel doet, niet **hoe**, en blijven groen vóór, tijdens en na de refactor.
