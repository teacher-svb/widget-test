class IGripperListener {
public:
    virtual ~IGripperListener() = default;
    virtual void OnGripperClosed() = 0;
    virtual void OnGripperOpened() = 0;
};

class CellController : public ISensorListener, public IArmListener,
                       public IGripperListener {
};
