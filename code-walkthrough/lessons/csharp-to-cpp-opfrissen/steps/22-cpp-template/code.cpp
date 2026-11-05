template <typename T>
T* GetComponent() const {
    for (const auto& component : components) {
        T* match = dynamic_cast<T*>(component.get());
        if (match != nullptr) return match;
    }
    return nullptr;
}

ArmIkComponent* arm = owner->GetComponent<ArmIkComponent>();
