## Quotes and special characters

Quotes inside a string:

- wrap the string in the **other** kind of quote: `'Ze zei: "Hallo"'`
- or **escape** the quote with a backslash: `"Ze zei: \"Hallo\""`

The backslash starts a special character:

- `\n` a new line
- `\t` a tab
- `\\` one real backslash, for example in a Windows path

**Pitfall:** `"C:\temp"` contains a tab, not a backslash and a `t`.

Only backticks let a string span several lines without `\n`. This is the same as in C#, except for that last point (C# uses `@"..."` or `"""..."""` for that).
