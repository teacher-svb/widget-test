public T GetComponent<T>() where T : Component
{
    foreach (var component in components)
    {
        T match = component as T;
        if (match != null) return match;
    }
    return null;
}

var arm = owner.GetComponent<ArmIkComponent>();
