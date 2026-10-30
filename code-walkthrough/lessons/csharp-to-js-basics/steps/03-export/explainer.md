## Exporteren uit een module

```js
export const APP_NAME = "Webtech";
export function greet(name) { ... }
```

- Je hebt geen klasse nodig: een module kan constanten en functies rechtstreeks bevatten
- `export` speelt de rol van `public`: alleen wat je exporteert, kunnen andere bestanden gebruiken
- Er zijn geen types: `name` heeft geen `string`, en de functie heeft geen returntype

De tekst tussen backticks is een **template literal**: `${name}` zet de waarde van `name` in de tekst, zoals `$"Hallo {name}"` in C#.
