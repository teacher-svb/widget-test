using UnityEngine;

public class Spinner : MonoBehaviour
{
    [SerializeField] private Vector3 axis = Vector3.up;
    [SerializeField] private float degreesPerSecond = 90f;

    void Update()
    {
        transform.Rotate(axis, degreesPerSecond * Time.deltaTime);
    }
}
