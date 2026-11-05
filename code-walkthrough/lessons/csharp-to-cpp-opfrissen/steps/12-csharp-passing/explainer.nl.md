## Objecten doorgeven in C#

In C# hoef je niet na te denken over adressen: een object van een class is altijd een referentie.

- `listeners.Add(listener)`: de lijst krijgt een referentie
- `arm.MoveTo(...)`: een methode oproepen met een punt
- `ReferenceEquals(a, b)`: is dit hetzelfde object?
- `this`: het huidige object
