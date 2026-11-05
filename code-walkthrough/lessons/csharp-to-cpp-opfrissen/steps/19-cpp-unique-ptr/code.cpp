std::unique_ptr<ArmState> state = std::make_unique<PausedState>();
std::unique_ptr<ArmState> pending = std::make_unique<IdleState>();

state = std::move(pending);
