## std::vector in C++

- `List<T>` wordt `std::vector<T>`. Hier `ISensorListener*`: de sensor kent zijn listeners, maar is er geen eigenaar van.
- `Add` wordt `push_back`.
- [`std::erase(v, waarde)`](https://en.cppreference.com/w/cpp/container/vector/erase2) (C++20) verwijdert elk element gelijk aan `waarde`. Met een voorwaarde gebruik je `std::erase_if`.
- `foreach (T x in v)` wordt `for (T x : v)`.

> `push_back` kan een vector herallokeren. Daarna zijn alle pointers en referenties naar elementen van die vector ongeldig. Daarom bewaart `World` de kratten als `std::vector<std::unique_ptr<Crate>>` en niet als `std::vector<Crate>`: de grijper houdt een `Crate*` vast, en die moet blijven kloppen wanneer er een krat bijkomt.
