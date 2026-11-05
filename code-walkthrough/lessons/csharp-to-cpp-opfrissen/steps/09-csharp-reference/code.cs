World a = new World();
World b = a;                        // tweede referentie

b.crateCount = 5;
Console.WriteLine(a.crateCount);    // 5
