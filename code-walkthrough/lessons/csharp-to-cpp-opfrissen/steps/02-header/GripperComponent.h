#include "Component.h"
#include "Crate.h"
#include "World.h"

class GripperComponent : public Component {
public:
    GripperComponent(float strokeTime, World& world);
    void Update(float dt) override;
    bool IsClosed() const;

private:
    float strokeTime;
    float opening = 1.0f;
    World& world;
    Crate* held = nullptr;
};
