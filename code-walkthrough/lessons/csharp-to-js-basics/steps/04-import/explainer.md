## Importeren in een andere module

```js
import { APP_NAME, greet } from "./utils.js";
```

- Tussen `{ }` staan de namen die je nodig hebt, met dezelfde schrijfwijze als bij de export
- Na `from` volgt het pad naar het bestand, inclusief `.js`
- Dit lijkt wat op `using` in C#, maar je importeert losse namen uit één bestand

`console.log()` schrijft naar de console van de browser (F12, tabblad *Console*), zoals `Console.WriteLine()` in C#.

> Modules werken alleen als de pagina via HTTP geladen wordt, bijvoorbeeld met Live Server. Open je het HTML-bestand rechtstreeks vanaf je schijf, dan worden ze geblokkeerd.
