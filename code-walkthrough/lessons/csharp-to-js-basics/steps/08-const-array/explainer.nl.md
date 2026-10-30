## const legt de variabele vast, niet de inhoud

```js
const scores = [10, 15];
scores.push(20);   // mag
VAT_RATE = 0.06;   // TypeError
```

- De array achter `scores` kan nog veranderen
- `scores` of `VAT_RATE` een **nieuwe** waarde geven, geeft een fout

De live preview toont eerst de array en daarna de fout.

**Tip:** gebruik standaard `const`, en `let` alleen als de waarde moet veranderen. Zo ziet de lezer meteen welke waarden vastliggen.
