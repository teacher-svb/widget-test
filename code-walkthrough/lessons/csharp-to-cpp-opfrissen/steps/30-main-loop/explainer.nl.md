## Update en draw

- **`GetFrameTime()`**: seconden sinds de vorige frame. Elke `Update(float dt)` krijgt die door, zoals `_Process(double delta)` in Godot.
- Eerst alles updaten, dan alles tekenen. `Draw() const`: tekenen verandert niets.
- raylib is **immediate mode**: er is geen scene tree. Elke frame teken je alles opnieuw vanuit je eigen data. Daarom heeft elk object een eigen `Draw()`.

De input zit in `main`, niet in `Cell`. `Cell` krijgt enkel `PressStart()`. Zo kan een test een `Cell` aanmaken en "op start drukken" zonder toetsenbord en zonder venster.
