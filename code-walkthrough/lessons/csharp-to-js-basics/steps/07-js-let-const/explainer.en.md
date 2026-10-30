## let and const in JavaScript

- `int`, `string` and `var` all become `let`
- `const double VatRate` becomes `const VAT_RATE`: no type, and fixed values are often written in `UPPER_SNAKE_CASE`
- `Console.WriteLine` becomes `console.log`

Declare a variable **once**. A second `let score;` is a `SyntaxError`; after the declaration you only use the name.

> JavaScript also has `var`, the way to declare variables before 2015. It behaves differently from `let`, and also from `var` in C#. Only use it in old code.

Open **Live preview** to see the console output.
