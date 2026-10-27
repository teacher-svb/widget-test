## Add a little feedback

Small animations tell the user that something happened.

```css
@keyframes pop { 50% { transform: scale(1.25); } }
```

A keyframe only needs the steps that differ from normal. At 0% and 100% the number has its regular size.

### Restarting a CSS animation

Adding a class that is already there does nothing, so the animation would only play once. The trick:

- remove the class
- read `offsetWidth`, which forces the browser to apply the change
- add the class again

**Your turn:** make the counter go down on a second button, or change color when it reaches 10.
