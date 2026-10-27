## Count the clicks

The script follows a pattern you will use constantly:

1. **Find** the elements you need
2. **Keep** some state in a variable
3. **React** to an event by updating the state and the page

```js
button.addEventListener("click", () => {
  count = count + 1;
  output.textContent = count;
});
```

We use `textContent` instead of `innerHTML` because we only show text. It is faster and it cannot accidentally inject HTML.

> Why at the end of the body? The browser reads the page from top to bottom. A script placed earlier would run before the button exists.
