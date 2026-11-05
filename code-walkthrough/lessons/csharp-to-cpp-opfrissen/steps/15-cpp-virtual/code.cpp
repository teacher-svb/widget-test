class Component {
public:
    virtual ~Component() = default;
    virtual void Update(float dt) {}
};

class SensorComponent : public Component {
public:
    void Update(float dt) override;
};
