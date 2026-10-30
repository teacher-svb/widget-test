## Zoeken, vervangen, herhalen

- `indexOf` is **hoofdlettergevoelig**: `"Wereld"` wordt niet gevonden, dus `-1`
- `replace("la", "na")` vervangt alleen het **eerste** stuk dat overeenkomt
- `replace(/la/g, "na")` vervangt ze allemaal. `/la/g` is een reguliere expressie met de vlag *global*; voorlopig moet je ze alleen kunnen gebruiken
- `repeat(3)` plakt een string 3 keer aan zichzelf
- `toLowerCase()` is het omgekeerde van `toUpperCase()`
