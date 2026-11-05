// waarde: het object zit erin, en verdwijnt mee
World world;

// referentie: bestaat zeker, nooit nullptr
World& world;

// pointer: mag nullptr zijn, iemand anders is eigenaar
Crate* held = nullptr;

// unique_ptr: eigenaar, ruimt zelf op
std::unique_ptr<ArmState> state;
