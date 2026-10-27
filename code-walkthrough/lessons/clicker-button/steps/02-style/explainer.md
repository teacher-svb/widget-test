## Center and style it

Two CSS ideas do most of the work in this step.

### Centering with grid

```css
body {
  display: grid;
  place-items: center;
  min-height: 100vh;
}
```

`place-items: center` is shorthand for `align-items` and `justify-items`. Combined with `min-height: 100vh` the counter sits in the middle of the window.

### Buttons do not inherit fonts

Form controls use the browser's own font by default. `font: inherit` makes the button match the rest of the page.

**Try it:** pause the lesson, change `999px` to `4px` and watch the preview.
