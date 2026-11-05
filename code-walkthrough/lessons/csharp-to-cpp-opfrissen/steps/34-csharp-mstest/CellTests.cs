[TestMethod]
public void CelStartGepauzeerd()
{
    Cell cell = new Cell();

    Assert.AreEqual(StepId.Paused, cell.GetStep());
    Assert.AreEqual("Gepauzeerd", cell.GetStatusText());
    Assert.AreEqual(0, cell.GetCycleCount());
}
