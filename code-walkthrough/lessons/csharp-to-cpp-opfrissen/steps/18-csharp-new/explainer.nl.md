## new en de garbage collector

In C# hoef je niet op te ruimen: de garbage collector verwijdert de `PausedState` zodra niemand er nog naar verwijst.

Na `state = pending;` wijzen beide variabelen naar dezelfde `IdleState`.
