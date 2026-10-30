## Een script aan de pagina koppelen

Een C#-programma start vanzelf. JavaScript in de browser hoort altijd bij een HTML-pagina, die het script laadt met een `<script>`-element in de `<head>`:

```html
<script type="module" src="js/script.js"></script>
```

- `src` is het pad naar het JavaScript-bestand
- `type="module"` maakt van het bestand een **module**

Waarom een module?

- Variabelen blijven **lokaal** in hun bestand, zodat twee scripts elkaars namen niet kunnen overschrijven. Zonder modules is elke variabele globaal voor de hele pagina.
- Het script start pas **nadat** de HTML geladen is, dus `defer` heb je niet nodig.
- **Strict mode** staat automatisch aan, dus `"use strict";` is overbodig. Strict mode maakt van stille fouten echte foutmeldingen.
