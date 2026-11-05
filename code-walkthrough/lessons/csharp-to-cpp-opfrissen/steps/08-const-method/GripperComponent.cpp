GripperComponent::GripperComponent(float strokeTime, World& world)
    : strokeTime(strokeTime), world(world) {
}

bool GripperComponent::IsClosed() const {
    return opening == 0.0f;
}
