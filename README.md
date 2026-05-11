# juliantait.github.io

Personal academic website for Julian Tait. Hosted via GitHub Pages at
<https://juliantait.eu> (custom domain — see `CNAME`). To deploy, commit and
push from this folder.

## Layout

- `index.html`, `research.html`, `teaching.html`, `cv.html`, `contact.html` — pages
- `static/css/`, `static/js/`, `static/html/` — styles, theme toggle, navbar/footer partials
- `images/` — profile photo and institutional logos
- `Julian_Tait_CV.pdf` — compiled CV, embedded via `<iframe>` in `cv.html`

## CV source

The LaTeX source for the CV lives **outside this repo**, in a sibling folder
one level up at `../Academic CV/`. That folder is *not* deployed — only the
compiled PDF (`Julian_Tait_CV.pdf`, copied into `live/`) is served by the site.

```
academic/
├── Academic CV/            ← LaTeX source (not deployed)
│   ├── cv.tex              ← main entry point (Awesome-CV template)
│   └── cv/
│       ├── education.tex
│       ├── presentation.tex   ← conferences & talks
│       ├── teaching.tex
│       ├── honors.tex         ← grants & scholarships
│       └── extracurricular.tex
└── live/                   ← this repo, deployed to GitHub Pages
    └── Julian_Tait_CV.pdf
```

To update the on-site CV: edit the relevant `.tex` under `../Academic CV/cv/`,
recompile `cv.tex`, then copy the resulting PDF over `live/Julian_Tait_CV.pdf`
and push.
