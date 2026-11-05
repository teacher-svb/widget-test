## CMakeLists.txt

Alles behalve `main.cpp` zit in een library. Het programma **en** de tests linken met die library, zodat elke `.cpp` maar één keer gecompileerd wordt.

- `PUBLIC raylib`: wie `demo_lib` linkt, krijgt raylib er automatisch bij.
- raylib en Catch2 komen binnen via `FetchContent` in de `CMakeLists.txt` in de root. Daarom duurt de eerste build een paar minuten.

> Voeg elk nieuw `.cpp`-bestand toe aan `add_library` in `src/CMakeLists.txt`. Anders krijg je `undefined reference to ...` bij het linken.
