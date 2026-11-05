World a;
World b = a;                        // volledige kopie

b.crateCount = 5;
std::cout << a.crateCount;          // 0
