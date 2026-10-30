## Naming rules

The rules are almost the same as in C#:

- letters, digits, `$` and `_`; `$` and `_` are ordinary characters (C# does not allow `$`)
- not starting with a digit: `1a` is invalid
- no hyphen: `my-name` is invalid
- no reserved words such as `let`, `class`, `return` or `function`
- names are **case-sensitive**: `apple` and `AppLE` are different variables

The invalid lines are commented out, otherwise the whole script would stop with a `SyntaxError`. Try removing a `//` in the editor.
