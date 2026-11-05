## De declaratie in de header

C++ compileert elk `.cpp`-bestand **apart**, en kent enkel wat via `#include` letterlijk ingeplakt werd. Daarna koppelt de **linker** alles aan elkaar. Daarom splits je elke klasse in 2 bestanden:

- **`.h`**: wat een klasse **is**. De declaratie, het publieke contract.
- **`.cpp`**: wat een klasse **doet**. De implementatie van de methodes.

Let op de vorm:

- `class GripperComponent : public Component`: overerven met `public` ervoor
- `public:` en `private:` zijn **blokken**, niet per methode
- een `;` na de laatste `}`

`World&`, `Crate*`, `const` en de constructor komen verderop in de les.
