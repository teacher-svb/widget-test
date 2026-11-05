## unique_ptr en std::move

Na de laatste regel is de `PausedState` vernietigd, is `pending` leeg (`nullptr`), en is `state` eigenaar van de `IdleState`.

- Een [`std::unique_ptr`](https://en.cppreference.com/w/cpp/memory/unique_ptr) heeft precies **één eigenaar**. Verdwijnt de `unique_ptr`, dan verdwijnt het object.
- `std::make_unique<T>()` maakt het object. Geen `new`.
- Kopiëren kan niet, enkel **verplaatsen** met `std::move`.
- `.get()` geeft een gewone pointer, zonder eigenaarschap. `.reset()` vernietigt het object meteen.

> `use of deleted function 'std::unique_ptr<...>::unique_ptr(const std::unique_ptr<...>&)'` betekent: je probeert een `unique_ptr` te kopiëren. Meestal staat er een `for (auto c : components)` zonder `&`, of geef je een `unique_ptr` door zonder `std::move`.
