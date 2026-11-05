listeners.Add(listener);
endStop.Subscribe(controller);
arm.MoveTo(PickPoint);

if (ReferenceEquals(sensor, pickSensor)) { }
listener.OnSensorChanged(this, triggered);
