## Aanhalingstekens en speciale tekens

Aanhalingstekens in een string:

- zet de string tussen het **andere** soort aanhalingstekens: `'Ze zei: "Hallo"'`
- of **escape** het aanhalingsteken met een backslash: `"Ze zei: \"Hallo\""`

De backslash begint een speciaal teken:

- `\n` een nieuwe regel
- `\t` een tab
- `\\` één echte backslash, bijvoorbeeld in een Windows-pad

**Valkuil:** `"C:\temp"` bevat een tab, geen backslash en `t`.

Alleen met backticks kan een string over meerdere regels gaan zonder `\n`. Dat is hetzelfde als in C#, op dat laatste punt na (C# gebruikt daarvoor `@"..."` of `"""..."""`).
