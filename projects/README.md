# Building an interactive project page

This folder holds self-contained interactive companion pages for papers, one per
project, served at `juliantait.eu/projects/<slug>`. They all share one design
system (`shared/shell.css`) so they read as a family. This guide is the canonical
recipe for adding a new one.

## Reference examples

Copy patterns from the pages that already exist:

- `correlated-beliefs/` – hero + sticky topbar + SPA hash router swapping `.view`
  sections, inline-SVG charts. **Best skeleton to start from.**
- `experts/` – hero/topbar/tab pattern plus a canvas-based interactive game.
- `perceived/` – dot-estimation game on `<canvas>`, fee-treatment toggle, inline-SVG
  grouped bar charts with CI whiskers.

## 1. Start from the template

Copy `correlated-beliefs/index.html` as your skeleton, then strip its body content
back to the shell and rebuild your own `.view` sections. It already contains every
required piece below, wired correctly.

```
live/projects/<slug>/
  index.html         # the page
  <slug>.css         # page-specific styles (loaded after shell.css)
  assets/            # images, screenshots, data this page needs
```

The page is unlisted (no link from the main nav); it is reached directly by URL.

## 2. Required `<head>`

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/projects/shared/shell.css?v=9">
<link rel="stylesheet" href="<slug>.css?v=1">
```

- The two Google Fonts are **Source Serif 4** (headings) and **Inter** (body); load
  both, the shell expects them.
- Link `shared/shell.css` by **absolute** path (`/projects/shared/...`) so it works
  from `/projects/<slug>/`, and keep the `?v=` cache-buster.
- Then your page-specific stylesheet by relative path, also with a `?v=`.

## 3. Required page skeleton

Order matters: hero, then the sentinel, then the sticky topbar, then `.wrap` with
your `.view` sections.

```html
<header class="hero" id="hero">
  <div class="hero-inner">
    <a class="hero-home" href="/"><span class="hh-arrow" aria-hidden="true">&larr;</span> Home</a>
    <span class="eyebrow">EXPERIMENT</span>
    <h1 class="hero-title">Your Title</h1>
    <p class="hero-sub">A one-line question or subtitle.</p>
    <p class="hero-context">One line: interactive companion to the paper (with co-authors).</p>
  </div>
</header>
<div id="hdr-sentinel" aria-hidden="true"></div>

<div class="topbar" id="topbar">
  <div class="topbar-inner">
    <a class="topbar-home" href="/"><span class="hh-arrow" aria-hidden="true">&larr;</span> Home</a>
    <span class="topbar-title">Your Title</span>
    <nav>
      <a href="#one" data-view="one" class="active">Tab one</a>
      <a href="#two" data-view="two">Tab two</a>
    </nav>
  </div>
</div>

<main class="wrap">
  <section id="view-one" class="view"> ... </section>
  <section id="view-two" class="view hidden"> ... </section>
</main>
```

Conventions the two boilerplate scripts below rely on: nav links carry
`data-view="X"` and `href="#X"`; each pane is `id="view-X"`; the initially hidden
panes also carry `class="hidden"`.

**Required: a "back to homepage" link in two places.** Every project page must
include the `.hero-home` link at the top of `.hero-inner` (visible while the user
is still at the top of the page) **and** the `.topbar-home` link on the left of
`.topbar-inner`, before `.topbar-title` (always visible once the sticky bar
detaches). Both point to `/` (the site root, `juliantait.eu`) and use the `&larr;
Home` label. Both are styled in `shell.css` (`.hero-home` = low-opacity white on
the dark hero that brightens on hover; `.topbar-home` = matches the nav-link look
in both the merged-with-hero and stuck states), so you only need the markup above.

### Boilerplate script A – sticky header (copy verbatim)

```html
<script>
(function(){
  var sentinel = document.getElementById('hdr-sentinel');
  var topbar = document.getElementById('topbar');
  if(sentinel && topbar && 'IntersectionObserver' in window){
    new IntersectionObserver(function(entries){
      topbar.classList.toggle('is-stuck', !entries[0].isIntersecting);
    }, {threshold:0}).observe(sentinel);
  }
})();
</script>
```

### Boilerplate script B – SPA hash router (copy verbatim, edit the view list)

```html
<script>
(function(){
  var NAV = Array.prototype.slice.call(document.querySelectorAll('.topbar nav a[data-view]'));
  var views = {
    one: document.getElementById('view-one'),
    two: document.getElementById('view-two')
  };
  function setView(name){
    if(!views[name]) name = 'one';               // default view
    Object.keys(views).forEach(function(k){
      views[k].classList.toggle('hidden', k !== name);
    });
    NAV.forEach(function(a){ a.classList.toggle('active', a.getAttribute('data-view') === name); });
  }
  NAV.forEach(function(a){
    a.addEventListener('click', function(e){
      e.preventDefault();
      var name = a.getAttribute('data-view');
      if(location.hash !== '#' + name){ location.hash = name; } else { setView(name); }
    });
  });
  function route(){ setView((location.hash || '').replace(/^#/, '') || 'one'); }
  window.addEventListener('hashchange', route);
  route();
})();
</script>
```

## 4. Reusable shell classes

Lean on these before writing your own CSS; they carry the shared look:

| Class | Use |
| --- | --- |
| `.panelcard` | the main white content card (padding, border, shadow) |
| `.card` | lighter bordered container |
| `.card-title` | serif card heading |
| `.card-note` | small muted sub-line under a title |
| `.card-head-row` | title left, control right (flex, wraps) |
| `.segmented` (`.segmented button.on`) | pill toggle group |
| `.slider-field` | labelled range slider (`.slideval` for the live value) |
| `.kpi` / `.kpis` | stat tiles in a flex row |
| `.legend` / `.sw` | chart legend row with colour swatches |
| `.note` | soft accent-tinted callout box |
| `.hidden` | `display:none` (used by the router) |

### Design tokens (`:root` in shell.css)

- `--accent:#4f46e5` (primary), `--accent-2:#7c5cff`
- group colours `--A:#6A3D9A`, `--B:#1F78B4`
- ink scale `--ink`, `--ink-soft`, `--muted`; lines `--line`, `--line-soft`;
  surfaces `--bg`, `--card`
- `--radius:14px`, `--maxw:1160px`, `--shadow`, `--shadow-sm`

Define any page-specific colours (for example a treatment palette) in your own
stylesheet's `:root`, not in the shell.

## 5. House rules

- **British spelling** throughout (colour, behaviour, visualise).
- **No em dashes** anywhere. Use en dashes (–), commas, or parentheses. This
  includes `&mdash;` entities, which render as em dashes, use `&ndash;`.
- **No lines connecting discrete groups in figures.** Plot each group as a mean
  with a 95% CI whisker over jittered points or bars; never draw a segment joining
  one group's mean to another's.
- **Self-contained vanilla JS only.** No frameworks, no external libraries, no build
  step. Inline SVG or `<canvas>` for charts.
- **Bump the `?v=`** on any shared or linked stylesheet whenever you edit it, so
  GitHub Pages caches do not serve a stale file. When you edit `shared/shell.css`,
  bump the `shell.css?v=` on **every** project page to the same new number.
- **Include the home link** in both the hero and the topbar (see section 3). It is
  styled in `shell.css`, so new pages inherit it for free from the markup.

## Deploy

There is no build step. A worker edits files in `live/`; bossman commits and pushes
`live/` to GitHub Pages. See the top-level `CLAUDE.md` for the deployment flow.
