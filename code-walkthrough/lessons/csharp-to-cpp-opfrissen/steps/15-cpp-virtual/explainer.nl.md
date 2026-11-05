## virtual en override in C++

- **`virtual`**: de methode is overschrijfbaar. Zonder `virtual` kiest de compiler de methode op basis van het type van de pointer: via een `Component*` loopt dan stil `Component::Update`, zonder fout of waarschuwing.
- **`override`**: achteraan. De compiler controleert dat er effectief een virtuele methode met die signatuur bestaat. In C++ is `override` optioneel, maar zet het er altijd bij. Zonder maakt een kleine afwijking (bv. een vergeten `const`) een nieuwe methode in plaats van een override.
- **Virtuele destructor** `virtual ~Component() = default;`: wordt een `SensorComponent` vernietigd via een `Component*` (wat een `unique_ptr<Component>` doet), dan loopt ook de destructor van `SensorComponent`. Heeft een klasse virtuele methodes, geef ze dan een virtuele destructor.
