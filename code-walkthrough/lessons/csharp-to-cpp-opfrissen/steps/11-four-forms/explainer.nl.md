## Vier manieren om een object vast te houden

- **Waarde** `World world;`: het object zit erin, en verdwijnt mee
- **Referentie** `World& world`: bestaat zeker, nooit `nullptr`, niet te verzetten
- **Pointer** `Crate* held`: mag `nullptr` zijn, iemand anders is eigenaar
- **`unique_ptr`** `std::unique_ptr<ArmState> state`: **eigenaar**, ruimt zelf op

> **Vuistregel**: verplicht, gebruik een referentie. Optioneel of in een lijst, gebruik een pointer. Eigenaar, gebruik een `unique_ptr`. Schrijf nooit zelf `new` of `delete`.

De demo bevat geen enkele `new`. `Cell` bevat de wereld, de devices en de listeners als waarde. Waar een object van een afgeleid type nodig is (een component, een state), zorgt een `unique_ptr` voor het opruimen.
