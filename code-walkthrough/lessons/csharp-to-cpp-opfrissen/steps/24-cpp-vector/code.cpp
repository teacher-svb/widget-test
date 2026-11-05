std::vector<ISensorListener*> listeners;

listeners.push_back(&listener);
std::erase(listeners, &listener);

for (ISensorListener* subscriber : listeners) {
    subscriber->OnSensorChanged(*this, triggered);
}
