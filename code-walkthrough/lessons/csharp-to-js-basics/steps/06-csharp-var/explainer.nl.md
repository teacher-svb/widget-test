## C# het type laten afleiden

```csharp
var highScore = score;   // nog altijd een int
var userName = "Ada";    // nog altijd een string
```

Met `var` kiest de compiler het type op basis van de waarde rechts. De variabele is nog altijd **statisch getypeerd**.

`int score;` blijft staan: `var` heeft een waarde nodig om naar te kijken. Ook een `const` heeft in C# een expliciet type nodig.
