/* Theme initialisation – runs immediately to avoid flash of wrong theme */
(function () {
  const saved = localStorage.getItem('theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
  }
})();

const navMarkup = `
<header class="nav-header">
  <div class="nav-container">
    <div class="nav-logo">
      <a href="index.html">Julian Tait</a>
    </div>
    <nav>
      <a class="nav-link" href="index.html">Home</a>
      <a class="nav-link" href="research.html">Research</a>
      <a class="nav-link" href="teaching.html">Teaching</a>
      <a class="nav-link" href="cv.html">CV</a>
      <button class="theme-toggle" type="button" aria-label="Toggle dark mode">
        <svg class="theme-icon theme-icon--sun" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        <svg class="theme-icon theme-icon--moon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
    </nav>
  </div>
</header>
`;

const footerMarkup = `
<footer class="site-footer">
  <p><span class="copyright-symbol">©</span> <span class="current-year">2026</span> Julian Tait</p>
</footer>
`;

const getFileName = () => {
  const path = window.location.pathname;
  const file = path.substring(path.lastIndexOf('/') + 1);
  return file || 'index.html';
};

const highlightActiveNav = (container) => {
  const currentPage = getFileName();
  const links = container.querySelectorAll('.nav-link');

  links.forEach((link) => {
    const href = link.getAttribute('href') || '';
    const target = href.split('/').pop() || href;

    if (target === currentPage || (currentPage === 'index.html' && target === '')) {
      link.classList.add('active');
    }
  });
};

const setFooterYear = (container) => {
  const yearElement = container.querySelector('.current-year');
  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }
};

/* Theme toggle logic */
function getEffectiveTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initThemeToggle(container) {
  const btn = container.querySelector('.theme-toggle');
  if (!btn) return;

  /* Set initial icon state */
  updateToggleIcon(btn, getEffectiveTheme());

  btn.addEventListener('click', () => {
    const current = getEffectiveTheme();
    const next = current === 'dark' ? 'light' : 'dark';

    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateToggleIcon(btn, next);
  });
}

function updateToggleIcon(btn, theme) {
  const sun = btn.querySelector('.theme-icon--sun');
  const moon = btn.querySelector('.theme-icon--moon');
  if (theme === 'dark') {
    sun.style.display = 'block';
    moon.style.display = 'none';
  } else {
    sun.style.display = 'none';
    moon.style.display = 'block';
  }
}

async function loadPartial(targetSelector, partialPath, afterLoad, fallback) {
  const host = document.querySelector(targetSelector);
  if (!host) return;

  try {
    const response = await fetch(partialPath);
    if (!response.ok) throw new Error(`Failed to load ${partialPath}`);

    const markup = await response.text();
    host.innerHTML = markup;

    if (afterLoad) afterLoad(host);
  } catch (error) {
    console.warn(`Partial load failed for ${partialPath}. Using fallback.`, error);
    if (fallback) {
      host.innerHTML = fallback;
      if (afterLoad) afterLoad(host);
    } else {
      host.innerHTML = '';
    }
  }
}

function afterNavLoad(container) {
  highlightActiveNav(container);
  initThemeToggle(container);
}

document.addEventListener('DOMContentLoaded', () => {
  loadPartial('[data-nav]', 'static/html/navbar.html', afterNavLoad, navMarkup);
  loadPartial('[data-footer]', 'static/html/footer.html', setFooterYear, footerMarkup);
});
