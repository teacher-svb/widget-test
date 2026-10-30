## Stringmethodes in JavaScript

- `Length` → `length` (een property, zonder haakjes)
- `Substring(start, lengte)` → `substring(start, einde)`: het teken op positie `einde` hoort er **niet** bij
- `IndexOf` → `indexOf`: de positie, of `-1` als het stuk niet gevonden wordt
- `Replace` → `replace`
- `ToUpper` / `ToLower` → `toUpperCase` / `toLowerCase`
- `Trim` → `trim`: haalt spaties, tabs en enters weg aan het begin en het einde, niet in het midden

Er is geen apart type voor één teken: `text[0]` is de string `"H"`.

> Vermijd de oude methode `substr()`: die werkt anders en is verouderd.
