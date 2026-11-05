public abstract class Component
{
    public virtual void Update(float dt) { }
}

public class SensorComponent : Component
{
    public override void Update(float dt) { }
}
