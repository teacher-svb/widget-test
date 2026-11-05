TEST_CASE("De cel start gepauzeerd", "[cel]") {
    Cell cell;

    REQUIRE(cell.GetStep() == StepId::Paused);
    REQUIRE(cell.GetStatusText() == "Gepauzeerd");
    REQUIRE(cell.GetCycleCount() == 0);
}
