# Function Guesser

A small static Desmos puzzle app where one player creates a hidden function and shares a link, then another player tries to recreate that function from the graph.

## Features

- Desmos-powered creator and player graphs.
- One-click puzzle link export with author name.
- Puzzle data stored in the URL hash, so there is no backend or database.
- Automatic guess checking against sampled points on the graph.
- Completion dialog with a Discord-ready share message.

## Run Locally

This app has no build step. Serve the folder with any static file server:

```sh
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

You can also open `index.html` directly, but serving over `localhost` gives the browser better access to clipboard and Web Crypto APIs.

## How To Play

### Create a puzzle

1. Open the app without a `#play=` URL hash.
2. Edit the starter Desmos expression into a function like `f(x)=x^2`.
3. Click **Export Link**.
4. Enter a name, or leave it blank for `Anonymous`.
5. Share the copied link.

### Solve a puzzle

1. Open a shared puzzle link.
2. Use the Desmos expression list to enter a guess.
3. The app accepts standalone expressions, `y=...`, or functions like `g(x)=...`.
4. When a guess matches the target function closely enough, the completion dialog appears.

Guesses must be functions of `x` and cannot reference `f(x)` directly.

## Matching

The checker samples the secret function and the guessed function from `x=-10` to `x=10`. A puzzle is solved when enough finite sample points match within a small absolute and relative tolerance.

This means two functions that are equivalent over the sampled range can solve the same puzzle, even if they are written differently.

## Project Files

- `index.html` - app shell, Desmos script, and completion dialog markup.
- `styles.css` - full-screen layout and dialog styling.
- `app.js` - puzzle encoding, Desmos setup, link handling, and guess matching.

## Notes

Function Guesser is a client-only app. Puzzle links are meant to hide the answer from normal play, not provide strong security against someone inspecting the source code or browser state.
