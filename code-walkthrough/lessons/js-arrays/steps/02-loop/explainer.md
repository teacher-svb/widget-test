## Loop and calculate

`for...of` walks over the values of an array, one at a time:

```js
for (const score of scores) {
  total += score;
}
```

`total += score` is short for `total = total + score`.

**Challenge:** also find the highest score. Start with `let best = scores[0];` and update it inside the loop.
