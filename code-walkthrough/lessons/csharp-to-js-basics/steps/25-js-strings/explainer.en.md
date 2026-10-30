## String methods in JavaScript

- `Length` → `length` (a property, no parentheses)
- `Substring(start, length)` → `substring(start, end)`: the character at position `end` is **not** included
- `IndexOf` → `indexOf`: the position, or `-1` if it is not found
- `Replace` → `replace`
- `ToUpper` / `ToLower` → `toUpperCase` / `toLowerCase`
- `Trim` → `trim`: removes spaces, tabs and newlines at the start and the end, not in the middle

There is no separate type for one character: `text[0]` is the string `"H"`.

> Avoid the old `substr()` method: it works differently and is outdated.
