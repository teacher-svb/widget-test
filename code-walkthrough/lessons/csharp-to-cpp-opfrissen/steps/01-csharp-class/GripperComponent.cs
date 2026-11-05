public class GripperComponent : Component
{
    private float opening = 1.0f;
    private World world;
    private Crate held;

    public override void Update(float dt)
    {
        if (held == null)
        {
            held = world.FindCrateNear(PickPoint);
        }
    }

    public bool IsClosed()
    {
        return opening == 0.0f;
    }
}
