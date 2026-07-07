# Hypothesis-card spec (project homepages)

Every project homepage opens with a HYPOTHESIS card, optionally followed by a
RESULTS summary card in the same shape. All styling is shared and lives in
`projects/shared/shell.css` (from `?v=13`) — classes `hyp-card`, `hyp-head`,
`hyp-tag` (+ modifier `results`), `hyp-headline`, `hyp-text`, plus `pill-row` /
`pill-btn` for links into the project's subpages. Use the markup verbatim; do
not restyle locally.

```html
<!-- HYPOTHESIS -->
<section class="panelcard hyp-card">
  <div class="hyp-head">
    <span class="hyp-tag">Hypothesis</span>
    <span class="hyp-headline">One-sentence statement of the expected effect.</span>
  </div>
  <p class="hyp-text">A few plain sentences stating what was expected and why,
  sourced from the paper or design docs. Highlight the key phrases with
  <b>bold</b> (3&ndash;6 highlights; the styling recolours them slightly darker).
  No em dashes.</p>
</section>

<!-- RESULTS SUMMARY (same shape, muted tag) -->
<section class="panelcard hyp-card">
  <div class="hyp-head">
    <span class="hyp-tag results">Results</span>
    <span class="hyp-headline">One-sentence statement of what was found.</span>
  </div>
  <p class="hyp-text">Short summary with <b>bold</b> highlights and the headline
  numbers.</p>
  <div class="pill-row">
    <a class="pill-btn" href="model.html">Explore the model</a>
    <!-- one pill per subpage; labels like "Explore the experiment",
         "Explore the model", "Play the game" -->
  </div>
</section>
```

Conventions
- The cards are the first children of `<main class="wrap">`, hypothesis first.
- Header text is exactly `Hypothesis` / `Results` (the CSS uppercases it).
- The headline is sentence case with a trailing period, serif (automatic).
- `hyp-tag` renders accent purple; `hyp-tag results` renders muted ink.
- Reference pages already using this pattern: `perceived/index.html`,
  `correlated-beliefs/index.html`, `experts/index.html`.
- Pages must load `shell.css?v=13` (or later) for these styles to exist.
