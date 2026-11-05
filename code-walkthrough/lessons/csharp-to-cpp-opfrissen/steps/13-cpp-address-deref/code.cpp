listeners.push_back(&listener);
endStop->Subscribe(*controller);
arm->MoveTo(PickPoint);

if (&sensor == &pickSensor) { }
listener->OnSensorChanged(*this, triggered);
