## Infinity en NaN

JavaScript crasht niet bij een rekenfout. Het type number heeft daarvoor speciale waarden:

- `Infinity` en `-Infinity`: delen door nul. Zie je dit, dan heb je waarschijnlijk per ongeluk door nul gedeeld
- `NaN`, "not a number": een berekening die mislukt, zoals tekst gedeeld door een getal

`parseInt()` zet tekst om naar een geheel getal, en geeft `NaN` als de tekst geen getal is. In C# gooit `int.Parse("abc")` in dat geval een exception.
