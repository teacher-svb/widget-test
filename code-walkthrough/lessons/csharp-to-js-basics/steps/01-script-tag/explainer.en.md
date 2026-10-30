## Link a script to the page

A C# program starts by itself. JavaScript in the browser always belongs to an HTML page, which loads it with a `<script>` element in the `<head>`:

```html
<script type="module" src="js/script.js"></script>
```

- `src` is the path to the JavaScript file
- `type="module"` makes the file a **module**

Why a module?

- Variables stay **local** to their file, so two scripts cannot overwrite each other's names. Without modules every variable is global for the whole page.
- The script runs **after** the HTML is loaded, so you do not need `defer`.
- **Strict mode** is on automatically, so you do not need `"use strict";`. Strict mode turns silent mistakes into real errors.
