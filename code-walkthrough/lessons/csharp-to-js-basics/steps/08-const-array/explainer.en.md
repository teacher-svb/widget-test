## const fixes the variable, not the content

```js
const scores = [10, 15];
scores.push(20);   // allowed
VAT_RATE = 0.06;   // TypeError
```

- The array behind `scores` can still change
- Giving `scores` or `VAT_RATE` a **new** value is an error

The live preview shows the array first, then the error.

**Tip:** use `const` by default, and `let` only when the value has to change. The reader then sees straight away which values are fixed.
