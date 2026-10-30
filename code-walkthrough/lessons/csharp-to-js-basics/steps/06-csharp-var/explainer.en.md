## Let C# infer the type

```csharp
var highScore = score;   // still an int
var userName = "Ada";    // still a string
```

With `var` the compiler picks the type from the value on the right. The variable is still **statically typed**.

`int score;` stays: `var` needs a value to look at. A `const` also needs an explicit type in C#.
