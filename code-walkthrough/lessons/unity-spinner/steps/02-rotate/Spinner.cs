using UnityEngine;

public class Spinner : MonoBehaviour
{
    public float speed = 90f;

    void Update()
    {
        transform.Rotate(0f, speed, 0f);
    }
}
