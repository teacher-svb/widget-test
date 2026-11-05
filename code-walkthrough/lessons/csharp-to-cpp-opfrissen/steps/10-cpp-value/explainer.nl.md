## Waardesemantiek in C++

Het grootste verschil met C#: **waardesemantiek**.

- `World a;` maakt meteen een object, zonder `new`.
- `World b = a;` maakt een **volledige kopie**. Elk object is standaard een waarde, ook een `class`.

Daarom kies je in C++ bij **elk veld en elke parameter** zelf hoe je een object vasthoudt. In C# beslist het type (class of struct) dat voor je.
