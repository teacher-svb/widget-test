add_library(demo_lib
    ArmIkComponent.cpp
    ArmStates.cpp
    Cell.cpp
    CellController.cpp
    GripperComponent.cpp
)
target_link_libraries(demo_lib PUBLIC raylib)

add_executable(demo main.cpp)
target_link_libraries(demo PRIVATE demo_lib)
