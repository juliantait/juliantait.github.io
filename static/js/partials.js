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

document.addEventListener('DOMContentLoaded', () => {
  loadPartial('[data-nav]', 'static/html/navbar.html', highlightActiveNav, navMarkup);
  loadPartial('[data-footer]', 'static/html/footer.html', setFooterYear, footerMarkup);
});

