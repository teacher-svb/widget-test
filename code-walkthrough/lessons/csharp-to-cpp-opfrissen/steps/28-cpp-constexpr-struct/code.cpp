namespace {
    constexpr float SpawnInterval = 6.0f;
}

struct Crate {
    Rectangle bounds;
    bool onBelt = true;
    bool gripped = false;
};
