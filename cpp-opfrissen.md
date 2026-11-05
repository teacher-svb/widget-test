# C++ opfrissen

De herhaling van blok 1 en 2 gebeurt in C++, met [raylib](https://www.raylib.com/). Deze pagina frist de C++ op die de robotcel-demo gebruikt, telkens vertrekkend van wat je al kent uit C#. Alles hier zag je in het vak [C++ Programming](https://apwt.gitbook.io/ba-imt-c++-programming), op `dynamic_cast` na.

## Van C# naar C++

| C# | C++ |
|---|---|
| 1 bestand per klasse | `Foo.h` (declaratie) + `Foo.cpp` (implementatie) |
| `interface IListener` | abstracte klasse met enkel `= 0`-methodes |
| `virtual` / `override` | `virtual` / `override`, `= 0` voor abstract |
| `List<T>` | `std::vector<T>` |
| garbage collector ruimt op | jij kiest: waarde, `&`, `*` of `std::unique_ptr` |
| `obj as T` | `dynamic_cast<T*>(ptr)` |
| `[TestMethod]` + `Assert` | `TEST_CASE` + `REQUIRE` (Catch2) |

Het grootste verschil staat niet in de tabel: **waardesemantiek**. In C# maakt `var a = b;` voor een class een tweede referentie naar hetzelfde object. In C++ maakt `World a = b;` een volledige kopie. Elk object is standaard een waarde, ook een `class`. Daarom kies je in C++ bij elk veld en elke parameter zelf hoe je een object vasthoudt. In C# beslist het type (class of struct) dat voor je.

## Header en source

C# compileert het hele project in één keer: de compiler kent alle types. C++ compileert elk `.cpp`-bestand apart, en kent enkel wat via `#include` letterlijk ingeplakt werd. Daarna koppelt de linker alles aan elkaar. Daarom splits je elke klasse in 2 bestanden:

- **`.h`**: wat een klasse **is**. De declaratie, het publieke contract.
- **`.cpp`**: wat een klasse **doet**. De implementatie van de methodes.

```cpp
#pragma once
#include "Component.h"

struct Crate;
class World;

class GripperComponent : public Component {
public:
    GripperComponent(float strokeTime, World& world);
    void Update(float dt) override;
    bool IsClosed() const;

private:
    World& world;
    Crate* held = nullptr;
};
```

`#pragma once` zorgt dat een header maar één keer ingelezen wordt per `.cpp`-bestand. Zonder krijg je `redefinition of class` zodra een header via 2 paden binnenkomt.

{% hint style="warning" %}
Een functiebody in een header, buiten de klasse, geeft `multiple definition` bij het linken zodra 2 `.cpp`-bestanden die header includen. Zet implementaties in de `.cpp`. Uitzonderingen: korte methodes met hun body in de klasse zelf, en templates.
{% endhint %}

### Forward declarations

`class World;` in plaats van `#include "World.h"` heet een **forward declaration**. Ze vertelt de compiler enkel dat er een klasse `World` bestaat.

- Een pointer of referentie naar `World` declareren heeft enkel de **naam** nodig.
- Een methode van `World` oproepen, of een `World` als waarde bewaren, heeft de **inhoud** nodig: `#include "World.h"` in de `.cpp`.

Forward declarations doorbreken ook cirkels. `Device.h` include `Component.h`, en een component kent zijn device:

```cpp
class Device;

class Component {
protected:
    Device* owner = nullptr;
};
```

Met een `#include "Device.h"` in `Component.h` zou elk van beide headers de andere nodig hebben. `#pragma once` lost dat niet op: de tweede keer is de header leeg, en je krijgt `'Device' does not name a type`.

{% hint style="success" %}
Vuistregel: forward declareer in de header wat kan, include in de `.cpp` wat je gebruikt.
{% endhint %}

## Constructors en const

```cpp
GripperComponent::GripperComponent(float strokeTime, World& world)
    : strokeTime(strokeTime), world(world) {
}

bool GripperComponent::IsClosed() const {
    return opening == 0.0f;
}
```

- **Initializer list** (`: strokeTime(strokeTime), world(world)`): de velden krijgen hun waarde vóór de body loopt. Een referentieveld zoals `World& world` moet hier: achteraf toewijzen kan niet.
- **Default member initializer** in de header: `Crate* held = nullptr;`. Zonder krijgt een pointer een willekeurige waarde, niet `nullptr`.
- **`const` methode**: `IsClosed() const` belooft dat de methode het object niet wijzigt. Op een `const` object, of via een `const`-referentie, roep je enkel `const` methodes op.

{% hint style="info" %}
Velden worden geïnitialiseerd in de volgorde waarin ze in de klasse **gedeclareerd** staan, niet in de volgorde van de initializer list. Ze worden vernietigd in omgekeerde volgorde. De demo gebruikt dat: in `Cell` staat `World world` als eerste veld, dus wordt het als laatste vernietigd, na alle componenten die een `World&` bijhouden.
{% endhint %}

## Waarde, referentie, pointer

| Vorm | Voorbeeld | Betekenis |
|---|---|---|
| Waarde | `World world;` | het object zit erin, en verdwijnt mee |
| Referentie | `World& world` | bestaat zeker, nooit `nullptr`, niet te verzetten |
| Pointer | `Crate* held` | mag `nullptr` zijn, iemand anders is eigenaar |
| `unique_ptr` | `std::unique_ptr<ArmState> state` | **eigenaar**, ruimt zelf op |

{% hint style="success" %}
Vuistregel: verplicht, gebruik een referentie. Optioneel of in een lijst, gebruik een pointer. Eigenaar, gebruik een `unique_ptr`. Schrijf nooit zelf `new` of `delete`.
{% endhint %}

De demo bevat geen enkele `new`. `Cell` bevat de wereld, de devices en de listeners als waarde. Waar een object van een afgeleid type nodig is (een component, een state), zorgt een `unique_ptr` voor het opruimen.

### &, * en ->

`&` en `*` betekenen iets anders in een **type** dan in een **expressie**:

- In een type: `World&` is een referentie, `Crate*` is een pointer.
- In een expressie: `&x` is "het adres van x", `*p` is "het object achter p".

| Code | Betekenis |
|---|---|
| `&listener` | het adres: van object naar pointer |
| `*controller` | het object achter de pointer: van pointer naar referentie |
| `arm->MoveTo(PickPoint)` | methode oproepen via een pointer, kort voor `(*arm).MoveTo(...)` |
| `&sensor == &pickSensor` | hetzelfde object? Vergelijk de adressen. |
| `*this` | het huidige object, als referentie |

```cpp
listeners.push_back(&listener);
endStop->Subscribe(*controller);
listener->OnSensorChanged(*this, triggered);
```

`&sensor == &pickSensor` vergelijkt identiteit, zoals `ReferenceEquals` in C#. `this` is in C++ een pointer, geen referentie: een methode die een referentie vraagt, krijgt `*this`.

## Overerving en virtual

```cpp
class Component {
public:
    virtual ~Component() = default;
    virtual void Update(float dt) {}
};

class SensorComponent : public Component {
public:
    void Update(float dt) override;
};
```

- **`virtual`**: de methode is overschrijfbaar. Zonder `virtual` kiest de compiler de methode op basis van het type van de pointer: via een `Component*` loopt dan stil `Component::Update`, zonder fout of waarschuwing.
- **`override`**: de compiler controleert dat er effectief een virtuele methode met die signatuur bestaat. In C++ is `override` optioneel, maar zet het er altijd bij. Zonder maakt een kleine afwijking (bv. een vergeten `const`) een nieuwe methode in plaats van een override.
- **Virtuele destructor**: wordt een `SensorComponent` vernietigd via een `Component*` (wat een `unique_ptr<Component>` doet), dan loopt ook de destructor van `SensorComponent`. Heeft een klasse virtuele methodes, geef ze dan een virtuele destructor.

### Interfaces

C++ kent geen `interface`. Een abstracte klasse met enkel **pure virtual** methodes (`= 0`) speelt die rol:

```cpp
class IGripperListener {
public:
    virtual ~IGripperListener() = default;
    virtual void OnGripperClosed() = 0;
    virtual void OnGripperOpened() = 0;
};

class CellController : public ISensorListener, public IArmListener,
                       public IGripperListener { ... };
```

Eén `= 0` maakt een klasse abstract: je kan ze niet instantiëren. Meerdere interfaces overerven is veilig, want ze hebben geen velden en dus geen diamond-probleem.

Een interface mag ook lege bodies `{}` geven in plaats van `= 0`. Dan overschrijft een listener enkel wat hij nodig heeft, vergelijkbaar met default interface methods in C#. Het nadeel: vergeet je een methode te overschrijven, dan zegt de compiler niets.

## Eigenaarschap met unique_ptr

```cpp
std::unique_ptr<ArmState> state = std::make_unique<PausedState>();
std::unique_ptr<ArmState> pending = std::make_unique<IdleState>();

state = std::move(pending);
```

Na de laatste regel is de `PausedState` vernietigd, is `pending` leeg (`nullptr`), en is `state` eigenaar van de `IdleState`.

- Een [`std::unique_ptr`](https://en.cppreference.com/w/cpp/memory/unique_ptr) heeft precies **één eigenaar**. Verdwijnt de `unique_ptr`, dan verdwijnt het object.
- Kopiëren kan niet, enkel **verplaatsen** met `std::move`.
- `.get()` geeft een gewone pointer, zonder eigenaarschap. `.reset()` vernietigt het object meteen.

De signatuur van een functie vertelt zo wie eigenaar wordt:

| Parameter | Betekenis |
|---|---|
| `std::unique_ptr<T>` | "ik neem het eigenaarschap over" |
| `T&` | "ik gebruik dit, het bestaat zeker" |
| `T*` | "ik gebruik dit misschien, het kan `nullptr` zijn" |

{% hint style="warning" %}
`use of deleted function 'std::unique_ptr<...>::unique_ptr(const std::unique_ptr<...>&)'` betekent: je probeert een `unique_ptr` te kopiëren. Meestal staat er een `for (auto c : components)` zonder `&`, of geef je een `unique_ptr` door zonder `std::move`.
{% endhint %}

## Templates en dynamic_cast

```cpp
template <typename T>
T* GetComponent() const {
    for (const auto& component : components) {
        T* match = dynamic_cast<T*>(component.get());
        if (match != nullptr) return match;
    }
    return nullptr;
}
```

```cpp
ArmIkComponent* arm = owner->GetComponent<ArmIkComponent>();
```

- **Template**: de compiler maakt een aparte versie per type `T` waarmee je de functie gebruikt. Daarom staat de definitie in de **header**: de compiler moet de body zien in elke `.cpp` die `GetComponent<ArmIkComponent>` oproept. Een template-body in een `.cpp` geeft `undefined reference` bij het linken.
- **[`dynamic_cast<T*>`](https://en.cppreference.com/w/cpp/language/dynamic_cast)** (nieuw): is dit object een `T`? Ja: een pointer naar dat object. Nee: `nullptr`. De C++-versie van `as` in C#. Werkt enkel op klassen met minstens één virtuele methode.
- **`const auto&`**: elk element als referentie, zonder kopie. Een `unique_ptr` kopiëren kan trouwens niet.

{% hint style="info" %}
`dynamic_cast` doorloopt de klassenhiërarchie at runtime en is dus trager dan een gewone oproep. Bij een device met 2 componenten, zoals de arm in de demo, is dat verwaarloosbaar. Wordt een opzoeking elke frame herhaald over veel componenten, bewaar dan de pointer na de eerste keer, zoals je in Godot `GetNode` in `_Ready` oproept en niet in elke `_Process`.
{% endhint %}

## vector en enum class

```cpp
std::vector<ISensorListener*> listeners;

listeners.push_back(&listener);
std::erase(listeners, &listener);

for (ISensorListener* listener : listeners) {
    listener->OnSensorChanged(*this, triggered);
}
```

[`std::erase(v, waarde)`](https://en.cppreference.com/w/cpp/container/vector/erase2) (C++20) verwijdert elk element gelijk aan `waarde`. Met een voorwaarde gebruik je `std::erase_if`.

{% hint style="warning" %}
`push_back` kan een vector herallokeren. Daarna zijn alle pointers en referenties naar elementen van die vector ongeldig. Daarom bewaart `World` de kratten als `std::vector<std::unique_ptr<Crate>>` en niet als `std::vector<Crate>`: de grijper houdt een `Crate*` vast, en die moet blijven kloppen wanneer er een krat bijkomt.
{% endhint %}

`enum class Lamp { Green, Amber, Red };` schrijf je altijd met de naam ervoor: `StackLight::Lamp::Red`. Een `enum class` zet zijn namen niet in de omringende scope en zet niet stil om naar `int`.

## Constanten, anonieme namespace en struct

```cpp
namespace {
    constexpr float SpawnInterval = 6.0f;
    constexpr Rectangle SpawnArea = {40, 470, 50, 50};
}

struct Crate {
    Rectangle bounds;
    bool onBelt = true;
    bool gripped = false;
};
```

- **`constexpr`**: een constante die gekend is bij het compileren. `Layout.h` bundelt alle posities en snelheden van de cel als `constexpr`.
- **Anonieme namespace**: alles erin is enkel zichtbaar in dit `.cpp`-bestand. Zo botsen 2 hulpfuncties met dezelfde naam in 2 verschillende bestanden niet bij het linken.
- **`struct`**: een klasse waarin alles standaard `public` is. Dat is het enige verschil met `class`.

{% hint style="warning" %}
In C# is een `struct` een waardetype en een `class` een referentietype. In C++ niet: beide zijn waardetypes, beide kunnen methodes, constructors en overerving hebben. De demo gebruikt `struct` als conventie voor data zonder gedrag.
{% endhint %}

## De raylib game loop

```cpp
int main() {
    InitWindow(ScreenWidth, ScreenHeight, "Robotcel (demo)");
    Cell cell;

    while (!WindowShouldClose()) {
        if (IsKeyPressed(KEY_S)) cell.PressStart();
        cell.Update(GetFrameTime());
        BeginDrawing();
        cell.Draw();
        EndDrawing();
    }
    CloseWindow();
}
```

- **`GetFrameTime()`**: seconden sinds de vorige frame. Elke `Update(float dt)` krijgt die door, zoals `_Process(double delta)` in Godot.
- Eerst alles updaten, dan alles tekenen. `Draw() const`: tekenen verandert niets.
- raylib is **immediate mode**: er is geen scene tree. Elke frame teken je alles opnieuw vanuit je eigen data. Daarom heeft elk object een eigen `Draw()`.

De input zit in `main`, niet in `Cell`. `Cell` krijgt enkel `PressStart()`. Zo kan een test een `Cell` aanmaken en "op start drukken" zonder toetsenbord en zonder venster.

## CMake

```cmake
add_library(demo_lib
    ArmIkComponent.cpp
    ArmStates.cpp
    Cell.cpp
    CellController.cpp
    ...
)
target_link_libraries(demo_lib PUBLIC raylib)

add_executable(demo main.cpp)
target_link_libraries(demo PRIVATE demo_lib)
```

Alles behalve `main.cpp` zit in een library. Het programma **en** de tests linken met die library, zodat elke `.cpp` maar één keer gecompileerd wordt. `PUBLIC raylib` betekent: wie `demo_lib` linkt, krijgt raylib er automatisch bij. raylib en Catch2 komen binnen via `FetchContent` in de `CMakeLists.txt` in de root. Daarom duurt de eerste build een paar minuten.

{% hint style="danger" %}
Voeg elk nieuw `.cpp`-bestand toe aan `add_library` in `src/CMakeLists.txt`. Anders krijg je `undefined reference to ...` bij het linken.
{% endhint %}

### Compilerfout of linkerfout

| Melding | Wie | Oorzaak |
|---|---|---|
| `was not declared in this scope`, `does not name a type` | compiler | een ontbrekende `#include` of forward declaration |
| `undefined reference to ...` | linker | de declaratie is gevonden, de code niet |

Een `undefined reference` heeft bijna altijd een van deze oorzaken:

1. Het `.cpp`-bestand staat niet in `add_library`.
2. In de `.cpp` staat `void Update(float dt)` in plaats van `void SensorComponent::Update(float dt)`. Dat definieert een losse functie, en de methode blijft leeg.
3. Een methode staat gedeclareerd in de `.h`, maar is nooit geïmplementeerd.
4. Een template-body staat in een `.cpp`.

## Tests met Catch2

```cpp
TEST_CASE("De cel start gepauzeerd", "[cel]") {
    Cell cell;

    REQUIRE(cell.GetStep() == StepId::Paused);
    REQUIRE(cell.GetStatusText() == "Gepauzeerd");
    REQUIRE(cell.GetLamp() == StackLight::Lamp::Amber);
    REQUIRE(cell.GetCycleCount() == 0);
}
```

De tests gebruiken [Catch2 v3](https://github.com/catchorg/Catch2), zoals in het vak C++ Programming. Tags staan tussen `[]`. `REQUIRE` stopt de test bij de eerste fout, zoals `Assert` in MSTest. `CHECK` gaat verder en rapporteert alle fouten.

Net als in blok 1 en 2 gebruiken de tests enkel de publieke methodes van `Cell`. Ze beschrijven **wat** de cel doet, niet **hoe**, en blijven groen vóór, tijdens en na de refactor.
