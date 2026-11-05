## Forward declarations

`class World;` in plaats van `#include "World.h"` heet een **forward declaration**. Ze vertelt de compiler enkel dat er een klasse `World` bestaat.

- Een pointer of referentie naar `World` declareren heeft enkel de **naam** nodig.
- Een methode van `World` oproepen, of een `World` als waarde bewaren, heeft de **inhoud** nodig: `#include "World.h"` in de `.cpp`.

`Component` blijft een include: `GripperComponent` erft ervan over, en daarvoor moet de compiler de hele klasse kennen.

Forward declarations doorbreken ook **cirkels**. Een component kent zijn device (`Device* owner`) en een device kent zijn componenten. Includen ze elkaars header, dan lost `#pragma once` dat niet op: de tweede keer is de header leeg, en je krijgt `'Device' does not name a type`.
