List<ISensorListener> listeners = new List<ISensorListener>();

listeners.Add(listener);
listeners.Remove(listener);

foreach (ISensorListener subscriber in listeners)
{
    subscriber.OnSensorChanged(this, triggered);
}
