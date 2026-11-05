## &, * en -> in C++

`&` en `*` betekenen iets anders in een **type** dan in een **expressie**:

- In een type: `World&` is een referentie, `Crate*` is een pointer.
- In een expressie: `&x` is "het adres van x", `*p` is "het object achter p".

Uitgelegd per regel:

- `&listener`: het adres, van object naar pointer
- `*controller`: het object achter de pointer, van pointer naar referentie
- `arm->MoveTo(PickPoint)`: methode oproepen via een pointer, kort voor `(*arm).MoveTo(...)`
- `&sensor == &pickSensor`: hetzelfde object? Vergelijk de adressen, zoals `ReferenceEquals`
- `*this`: het huidige object als referentie. `this` zelf is een pointer.
