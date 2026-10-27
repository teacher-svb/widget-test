## The markup

We start with plain HTML and no styling at all. The page needs three things:

- a **label** so people know what is being counted
- an `<output>` element that shows the number
- a `<button>` to increase it

`<output>` is a good fit here: it is meant for the result of a calculation or a user action, and screen readers announce it as such.

> Give elements an `id` when you know your script needs to find exactly that element. Classes are for styling groups of elements.

Open the **Live preview** tab to see the unstyled result.
