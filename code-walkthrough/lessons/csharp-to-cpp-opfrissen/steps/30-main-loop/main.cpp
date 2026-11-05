int main() {
    InitWindow(ScreenWidth, ScreenHeight, "Robotcel (demo)");
    Cell cell;

    while (!WindowShouldClose()) {
        if (IsKeyPressed(KEY_S)) cell.PressStart();
        cell.Update(GetFrameTime());

        BeginDrawing();
        cell.Draw();
        EndDrawing();
    }
    CloseWindow();
}
