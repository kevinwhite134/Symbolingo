# Symbolingo / Notation Lab

Interactive maths notation trainer with plain-English translations, linked symbol explanations, multiple-choice practice and rapid-fire flashcards.

## Run locally

No build step or dependencies are required. Serve the `dist` directory:

```sh
python -m http.server 8000 --directory dist
```

Open http://localhost:8000 in your browser. Progress and saved cards are stored in browser local storage on each device.

## Source

- `dist/index.html`: page structure and responsive styles.
- `dist/app.js`: notation cards and all learning interactions.
- `.openai/hosting.json`: original Sites hosting configuration.

This repository is a source copy of Notation Lab. GitHub changes do not automatically deploy to the original Sites website.
