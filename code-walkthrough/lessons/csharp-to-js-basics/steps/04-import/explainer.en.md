## Import in another module

```js
import { APP_NAME, greet } from "./utils.js";
```

- Between `{ }` you list the names you need, spelled exactly as in the export
- After `from` comes the path to the file, including `.js`
- This is a bit like `using` in C#, but you import single names from one file

`console.log()` prints to the browser console (F12, tab *Console*), like `Console.WriteLine()` in C#.

> Modules only work when the page is served over HTTP, for example with Live Server. If you open the HTML file straight from disk, they are blocked.
