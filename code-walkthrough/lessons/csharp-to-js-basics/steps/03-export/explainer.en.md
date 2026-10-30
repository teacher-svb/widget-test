## Export from a module

```js
export const APP_NAME = "Webtech";
export function greet(name) { ... }
```

- No class is needed: a module can hold constants and functions directly
- `export` plays the role of `public`: only what you export can be used by other files
- There are no types: `name` has no `string`, and the function has no return type

The text between backticks is a **template literal**: `${name}` puts the value of `name` in the text, like `$"Hallo {name}"` in C#.
