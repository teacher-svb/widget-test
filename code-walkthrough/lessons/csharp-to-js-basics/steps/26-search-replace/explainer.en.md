## Searching, replacing, repeating

- `indexOf` is **case-sensitive**: `"Wereld"` is not found, so `-1`
- `replace("la", "na")` only replaces the **first** match
- `replace(/la/g, "na")` replaces every match. `/la/g` is a regular expression with the *global* flag; for now you only need to know how to use it
- `repeat(3)` glues a string to itself 3 times
- `toLowerCase()` is the opposite of `toUpperCase()`
