public interface IGripperListener
{
    void OnGripperClosed();
    void OnGripperOpened();
}

public class CellController : ISensorListener, IArmListener, IGripperListener
{
}
