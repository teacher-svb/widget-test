// ik neem het eigenaarschap over
void SetState(std::unique_ptr<ArmState> next);

// ik gebruik dit, het bestaat zeker
void Subscribe(ISensorListener& listener);

// ik gebruik dit misschien, het kan nullptr zijn
void Grip(Crate* crate);
