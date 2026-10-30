## Infinity and NaN

JavaScript does not crash on a calculation mistake. Instead, the number type has special values:

- `Infinity` and `-Infinity`: dividing by zero. If you see this, you probably divided by zero by accident
- `NaN`, "not a number": a calculation that fails, such as text divided by a number

`parseInt()` turns text into a whole number, and gives `NaN` when the text is not a number. In C# `int.Parse("abc")` throws an exception instead.
