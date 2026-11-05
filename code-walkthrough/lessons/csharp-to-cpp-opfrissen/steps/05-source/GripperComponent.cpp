#include "GripperComponent.h"
#include "World.h"

void GripperComponent::Update(float dt) {
    if (held == nullptr) {
        held = world.FindCrateNear(PickPoint);
    }
}

bool GripperComponent::IsClosed() const {
    return opening == 0.0f;
}
