## #pragma once

Een `.cpp` include `GripperComponent.h` en ook een andere header die zelf `Component.h` include. Zonder bescherming staat `Component` dan 2 keer in hetzelfde bestand, en krijg je `redefinition of class`.

`#pragma once` zorgt dat een header maar **één keer** ingelezen wordt per `.cpp`-bestand. Zet het bovenaan elke header.

> Een functiebody in een header, buiten de klasse, geeft `multiple definition` bij het linken zodra 2 `.cpp`-bestanden die header includen. Zet implementaties in de `.cpp`. Uitzonderingen: korte methodes met hun body in de klasse zelf, en templates.
