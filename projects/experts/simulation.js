// ============ Design constants (pilot) ============
// Each card is one series observed over a 100-UNIT x-window: n evenly spaced
// observation years across the window (the remaining years are missing records),
// labelled abstractly (yr 0 … yr 100) rather than as calendar years.
//
//   y_i = baseline + β · x_i + ε_i,   ε_i ~ N(0, σ²),   x_i ∈ [0, 100]
//
// β is therefore a per-year slope: the pilot's two growth arms are 2 or 3 per 100
// years, i.e. β = 0.02 / 0.03, default 0.03, against a flat state β = 0
// (prior 0.75 / 0.25).
// The baseline is an integer draw ~ Uniform[40, 80] per series so the dots sit at
// realistic heights; it shifts a series bodily and leaves β̂, SE and every
// downstream quantity untouched.
const WINDOW_YEARS = 100;                   // x-window length, in years
const X_SPAN = WINDOW_YEARS;                // x runs 0 … 100
const BASELINE_LO = 40, BASELINE_HI = 80;   // integer Uniform baseline level

// Integer y values. ON by default, matching the real experiment. The rounding
// happens at the DOT SIMULATION step (see observe()), so every downstream number
// — β̂, SE, likelihoods, posteriors, picks, error statistics — is computed from
// the realised integer values rather than from the raw continuous draws.
let intMode = true;

// One realised observation. This is the only place rounding happens.
function observe(v) { return intMode ? Math.round(v) : v; }

// σ as the ANALYSIS sees it. With integer y the observation an analyst actually
// has is round(baseline + βx + ε): the rounding error is ~Uniform(−½,½) and, for
// σ well above 1, near-independent of ε, so a realised value has variance
// σ² + 1/12. Every analytic quantity on the page (SEs, expected error rates,
// sampling PDFs, posteriors) uses this inflated σ so it describes the integer
// dots that are actually plotted rather than the raw draws behind them.
const ROUNDING_VAR = 1 / 12;
function analysisSigma(sigma) {
  return intMode ? Math.sqrt(sigma * sigma + ROUNDING_VAR) : sigma;
}

// ============ Math ============

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function Phi(z) {
  if (z === Infinity || z > 8) return 1;
  if (z === -Infinity || z < -8) return 0;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function phi(z) { return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI); }
// SS_x for x = linspace(0, X_SPAN, n): n evenly spaced observation years.
function ssX(n) { return X_SPAN * X_SPAN * n * (n + 1) / (12 * (n - 1)); }
function seBeta(sigma, n) { return sigma / Math.sqrt(ssX(n)); }
function ssOfX(x) {
  // SS_x for an arbitrary realised design (used when x is randomly drawn).
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i];
  const xbar = sum / x.length;
  let s = 0;
  for (let i = 0; i < x.length; i++) { const d = x[i] - xbar; s += d * d; }
  return s;
}

function bins(sortedBetas) {
  const k = sortedBetas.length;
  const out = [];
  for (let i = 0; i < k; i++) {
    const a = (i === 0) ? -Infinity : (sortedBetas[i-1] + sortedBetas[i]) / 2;
    const b = (i === k-1) ? Infinity : (sortedBetas[i] + sortedBetas[i+1]) / 2;
    out.push([a, b]);
  }
  return out;
}

function errProb(a, b, mu, se) { return 1 - (Phi((b - mu) / se) - Phi((a - mu) / se)); }

function avgConfCorrect(a, b, mu, se) {
  const s = se * Math.SQRT2;
  return Phi((b - mu) / s) - Phi((a - mu) / s);
}

// ============ Random-x sampling-side averages ============
// In fixed-x mode SE = σ/√SS_x is a constant and we use the analytic
// expressions above. In random-x mode x_i ~ iid Uniform(0, 100) so SS_x is
// random; we Monte-Carlo a fresh SE-array per Go press and reuse it for the
// expected error rate, expected confidence, and the plotted sampling PDFs
// of β̂. Per-card posterior bars are NOT averaged this way — they always
// condition on that card's own observed SS_x.

const MC_X_DRAWS = 1500;
let xMode = 'fixed';
let seCache = { mode: 'fixed', sigma: null, arrs: {} };

function sampleSEs(sigma, n, nDraws, baseSeed) {
  const rng = mulberry32(baseSeed >>> 0);
  const out = new Float64Array(nDraws);
  for (let d = 0; d < nDraws; d++) {
    let sum = 0, sumSq = 0;
    for (let i = 0; i < n; i++) {
      const xi = X_SPAN * rng();
      sum += xi;
      sumSq += xi * xi;
    }
    const ssx = sumSq - sum * sum / n;
    out[d] = sigma / Math.sqrt(Math.max(ssx, 1e-12));
  }
  return out;
}

function rebuildSeCache(sigma, ns, baseSeed) {
  if (xMode === 'fixed') { seCache = { mode: 'fixed', sigma, arrs: {} }; return; }
  const arrs = {};
  const seenSizes = Array.from(new Set(ns));
  seenSizes.forEach((n, i) => {
    arrs[n] = sampleSEs(sigma, n, MC_X_DRAWS, baseSeed + i * 7919);
  });
  seCache = { mode: 'random', sigma, arrs };
}

function effectiveSe(sigma, n) {
  if (xMode === 'fixed' || !seCache.arrs[n]) return sigma / Math.sqrt(ssX(n));
  const arr = seCache.arrs[n];
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

function errProbX(a, b, mu, n, sigma) {
  if (xMode === 'fixed' || !seCache.arrs[n]) return errProb(a, b, mu, sigma / Math.sqrt(ssX(n)));
  const arr = seCache.arrs[n];
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    s += Phi((b - mu) / arr[i]) - Phi((a - mu) / arr[i]);
  }
  return 1 - s / arr.length;
}

function avgConfX(a, b, mu, n, sigma) {
  if (xMode === 'fixed' || !seCache.arrs[n]) return avgConfCorrect(a, b, mu, sigma / Math.sqrt(ssX(n)));
  const arr = seCache.arrs[n];
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    const se = arr[i] * Math.SQRT2;
    s += Phi((b - mu) / se) - Phi((a - mu) / se);
  }
  return s / arr.length;
}

// ============ Bayes-optimal (MAP / posterior-mode) average error ============
// The MAP rule classifies β̂ to argmax_k [ ln(prior_k) − (β̂ − β_k)² / (2 se²) ].
// For equal se across candidates the decision boundary between adjacent sorted
// candidates β_i < β_{i+1} (priors π_i, π_{i+1}) is
//   t_i = (β_i + β_{i+1})/2 + se² · ln(π_i/π_{i+1}) / (β_{i+1} − β_i).
// Candidate k owns the interval [lower, upper] between its boundaries (±∞ at the
// ends). Per-true-state error = 1 − [Φ((upper−β)/se) − Φ((lower−β)/se)], and the
// MAP average error is the prior-weighted sum over true states.
function mapAvgErrorForSe(sortedBetas, sortedPriors, se) {
  const k = sortedBetas.length;
  const se2 = se * se;
  const t = new Array(k - 1);
  for (let i = 0; i < k - 1; i++) {
    const mid = (sortedBetas[i] + sortedBetas[i + 1]) / 2;
    t[i] = mid + se2 * Math.log(sortedPriors[i] / sortedPriors[i + 1]) / (sortedBetas[i + 1] - sortedBetas[i]);
  }
  let avg = 0;
  for (let kk = 0; kk < k; kk++) {
    const lower = (kk === 0) ? -Infinity : t[kk - 1];
    const upper = (kk === k - 1) ? Infinity : t[kk];
    const mu = sortedBetas[kk];
    const correct = Phi((upper - mu) / se) - Phi((lower - mu) / se);
    avg += sortedPriors[kk] * (1 - correct);
  }
  return avg;
}

// Mirror of errProbX's averaging: constant se in fixed-x mode, expectation over
// the MC SE-array in random-x mode (boundaries are se-dependent, so recompute
// the MAP partition per draw).
function mapAvgErrorX(sortedBetas, sortedPriors, n, sigma) {
  if (xMode === 'fixed' || !seCache.arrs[n]) {
    return mapAvgErrorForSe(sortedBetas, sortedPriors, sigma / Math.sqrt(ssX(n)));
  }
  const arr = seCache.arrs[n];
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += mapAvgErrorForSe(sortedBetas, sortedPriors, arr[i]);
  return s / arr.length;
}

function mixturePdf(z, mu, n, sigma) {
  // Sampling density p(z | β = mu) averaged over x in random mode (mixture of normals).
  if (xMode === 'fixed' || !seCache.arrs[n]) {
    const se = sigma / Math.sqrt(ssX(n));
    return phi((z - mu) / se) / se;
  }
  const arr = seCache.arrs[n];
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    const se = arr[i];
    s += phi((z - mu) / se) / se;
  }
  return s / arr.length;
}

// ============ State / DOM ============

const $ = (id) => document.getElementById(id);
// Initial #states comes from the segmented control's .active button so the JS
// state always matches the HTML default (which ships as the 2-state design);
// a hardcoded value here silently diverges when the HTML default changes.
let candCount = (() => {
  const act = document.querySelector('#seg-count button.active');
  return act ? parseInt(act.dataset.k, 10) : 3;
})();
// Caches so switching nav views can redraw canvases at the now-visible
// width without resampling (Monte-Carlo data only changes on a Go press).
let lastRender = null, lastExamples = null;

function formatDuration(ms) {
  if (ms < 1000) return `simulation took: ${ms.toFixed(1)} ms`;
  return `simulation took: ${(ms / 1000).toFixed(2)} s`;
}

function timedRecompute(silent) {
  const t0 = performance.now();
  const result = recompute(silent);
  const t1 = performance.now();
  $('sim-timer').textContent = formatDuration(t1 - t0);
  return result;
}

// apply the initial #states to the β₃/π₃ inputs (hidden in the 2-state design)
$('b3-group').classList.toggle('hidden', candCount !== 3);
$('p3-group').classList.toggle('hidden', candCount !== 3);

document.querySelectorAll('#seg-count button').forEach(b => {
  b.addEventListener('click', () => {
    candCount = parseInt(b.dataset.k, 10);
    document.querySelectorAll('#seg-count button').forEach(x =>
      x.classList.toggle('active', x === b));
    $('b3-group').classList.toggle('hidden', candCount !== 3);
    $('p3-group').classList.toggle('hidden', candCount !== 3);
    timedRecompute();
  });
});

// Growth-arm selector: the discrete amount gained over the 100-year window,
// 1–4 (default 2), written into the β₂ box as the per-year slope arm/100. β₂
// stays the single source of truth — type a value there and the buttons simply
// fall out of sync until one matches again (syncGrowthSeg, called by recompute).
document.querySelectorAll('#seg-growth button').forEach(b => {
  b.addEventListener('click', () => {
    $('b2').value = String(parseFloat(b.dataset.g) / WINDOW_YEARS);
    timedRecompute();
  });
});

function syncGrowthSeg() {
  const b2 = parseFloat($('b2').value);
  document.querySelectorAll('#seg-growth button').forEach(x =>
    x.classList.toggle('active',
      Math.abs(parseFloat(x.dataset.g) / WINDOW_YEARS - b2) < 1e-12));
}

// Integer y-values toggle. ON matches the real experiment; flipping it resimulates
// so the dots — and everything computed from them — change together.
document.querySelectorAll('#seg-intmode button').forEach(b => {
  b.addEventListener('click', () => {
    const on = b.dataset.int === '1';
    if (on === intMode) return;
    intMode = on;
    document.querySelectorAll('#seg-intmode button').forEach(x =>
      x.classList.toggle('active', x === b));
    timedRecompute();
  });
});

// Group-size selector for the bottom group-dynamics section: every group is
// 1 EXPERT + (size−1) NOVICES. Switching re-runs the group simulation.
document.querySelectorAll('#seg-size button').forEach(b => {
  b.addEventListener('click', () => {
    const size = parseInt(b.dataset.size, 10);
    N_NOVICES_PER_GROUP = size - 1;
    document.querySelectorAll('#seg-size button').forEach(x =>
      x.classList.toggle('active', x === b));
    const nv = $('size-nov'); if (nv) nv.textContent = N_NOVICES_PER_GROUP;
    timedRecompute();
  });
});

document.querySelectorAll('#seg-xmode button').forEach(b => {
  b.addEventListener('click', () => {
    if (xMode === b.dataset.xmode) return;
    xMode = b.dataset.xmode;
    document.querySelectorAll('#seg-xmode button').forEach(x =>
      x.classList.toggle('active', x === b));
    $('xmode-note').textContent = xMode === 'random'
      ? `x_i ~ iid Uniform(0, ${WINDOW_YEARS}) per member; each card's posterior conditions on its own observed SS_x.`
      : `x = linspace(0, ${WINDOW_YEARS}, n); every member shares the same design.`;
    timedRecompute();
  });
});

// n NOVICE / n EXPERT are now discrete toggles over only the pilot's sizes
// (NOVICE 3/4/5, EXPERT 15/20/30). Each writes its hidden source input so the
// rest of the engine (validate / readParam / recompute) reads it unchanged.
function wireSizeSeg(segId, inputId) {
  document.querySelectorAll('#' + segId + ' button').forEach(b => {
    b.addEventListener('click', () => {
      $(inputId).value = b.dataset.n;
      document.querySelectorAll('#' + segId + ' button').forEach(x =>
        x.classList.toggle('active', x === b));
      timedRecompute();
    });
  });
}
wireSizeSeg('seg-nnov', 'nNov');
wireSizeSeg('seg-nexp', 'nExp');

// Agent-behaviour toggle: 'rational' (the unchanged truthful-Bayesian engine)
// vs 'data' (members state a bet from the wave-1 empirical reaction model).
document.querySelectorAll('#seg-agentmode button').forEach(b => {
  b.addEventListener('click', () => {
    if (agentMode === b.dataset.mode) return;
    agentMode = b.dataset.mode;
    document.querySelectorAll('#seg-agentmode button').forEach(x =>
      x.classList.toggle('active', x === b));
    applyModeUI();
    timedRecompute();
  });
});

// Corner-lumps toggle (data-driven only): whether stated bets get the empirical
// point-masses at 0/50/100.
document.querySelectorAll('#seg-corners button').forEach(b => {
  b.addEventListener('click', () => {
    const on = b.dataset.corner === '1';
    if (on === cornerLumps) return;
    cornerLumps = on;
    document.querySelectorAll('#seg-corners button').forEach(x =>
      x.classList.toggle('active', x === b));
    timedRecompute();
  });
});

// Click the circled-i to reveal an explanatory popover; click the icon again or
// anywhere outside (or press Escape) to dismiss.
function wireInfoPopover(btnId, popId) {
  const btn = $(btnId), pop = $(popId);
  if (!btn || !pop) return;
  const setOpen = (open) => {
    if (open) pop.removeAttribute('hidden'); else pop.setAttribute('hidden', '');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(pop.hasAttribute('hidden'));
  });
  document.addEventListener('click', (e) => {
    if (!pop.contains(e.target) && e.target !== btn) setOpen(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
}
wireInfoPopover('xmode-info-btn', 'xmode-popover');
// "What this simulation is based on" — the overview popover by the mode toggle.
wireInfoPopover('basis-info-btn', 'basis-popover');

// ITEM 1: per-card "nearest" / "most likely" info popovers (dynamically rendered,
// so handled by event delegation on the document).
(() => {
  const closeAll = (except) => {
    document.querySelectorAll('.pick-pop:not([hidden])').forEach(p => {
      if (p === except) return;
      p.setAttribute('hidden', '');
      const b = p.closest('.pop-host').querySelector('.mini-info');
      if (b) b.setAttribute('aria-expanded', 'false');
    });
  };
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.mini-info');
    if (!btn) { if (!e.target.closest('.pick-pop')) closeAll(null); return; }
    e.stopPropagation();
    const pop = btn.closest('.pop-host').querySelector('.pick-pop');
    const open = pop.hasAttribute('hidden');
    closeAll(open ? pop : null);
    if (open) { pop.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true'); }
    else { pop.setAttribute('hidden', ''); btn.setAttribute('aria-expanded', 'false'); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(null); });
})();

$('go').addEventListener('click', () => timedRecompute());

// ITEM 4: pressing Enter ANYWHERE on the page presses Go and resimulates.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  // Let buttons (segmented toggles, Go, info icons) handle their own Enter so
  // we don't double-fire or break them; and never hijack Enter in a popover.
  if (e.target.closest('button')) return;
  if (e.target.closest('.info-popover')) return;
  e.preventDefault();
  timedRecompute();
});

function readNumber(id) {
  const v = parseFloat($(id).value);
  return isFinite(v) ? v : NaN;
}

// Sample size: a whole number of observation years, at least 2 and at most one
// per year in the 100-year window.
function readPositiveInt(id) {
  const v = parseFloat($(id).value);
  if (!isFinite(v) || v < 2 || v > WINDOW_YEARS || Math.floor(v) !== v) return NaN;
  return v;
}

function readPriors(count) {
  // Per-candidate prior probabilities, aligned to b1..b_count. Robust: each
  // value must be finite and >= 0 with a positive total, otherwise we fall
  // back to equal priors. Valid inputs are renormalised to sum to 1.
  const ids = count === 2 ? ['p1','p2'] : ['p1','p2','p3'];
  const vals = ids.map(id => parseFloat($(id).value));
  const ok = vals.length === count
    && vals.every(v => isFinite(v) && v >= 0)
    && vals.some(v => v > 0);
  if (!ok) return ids.map(() => 1 / count);
  const sum = vals.reduce((s, v) => s + v, 0);
  return vals.map(v => v / sum);
}

function setInvalid(id, bad) { $(id).classList.toggle('invalid', !!bad); }

function validate() {
  ['b1','b2','b3','sigma','nNov','nExp'].forEach(id => setInvalid(id, false));
  const ids = candCount === 2 ? ['b1','b2'] : ['b1','b2','b3'];
  const betas = ids.map(readNumber);
  const errs = [];

  betas.forEach((v, i) => { if (isNaN(v)) { errs.push('β'); setInvalid(ids[i], true); } });

  const seen = new Set();
  betas.forEach((v, i) => {
    if (!isNaN(v)) {
      if (seen.has(v)) { errs.push('distinct β'); setInvalid(ids[i], true); }
      seen.add(v);
    }
  });

  const sigma = readNumber('sigma');
  if (!(sigma > 0)) { errs.push('σ>0'); setInvalid('sigma', true); }
  const nN = readPositiveInt('nNov');
  if (isNaN(nN)) { errs.push(`n_NOVICE 2–${WINDOW_YEARS}`); setInvalid('nNov', true); }
  const nE = readPositiveInt('nExp');
  if (isNaN(nE)) { errs.push(`n_EXPERT 2–${WINDOW_YEARS}`); setInvalid('nExp', true); }

  return { errs, betas, sigma, nN, nE };
}

// ============ Data-driven (wave 1) behavioural model ============
// Copied verbatim from _ai_build/empirical_params_wave1.json (wave-1 completers,
// 10 participants × 24 rounds). Inlined rather than fetched so the page needs no
// server round-trip and no _ai_build deploy. The generative rule (json README §4):
//   bet = intercept + slope·(100·posterior_Growing) + Normal(0, residual_sd),
//   then clamp to [0,100].
// pooled-OLS reaction line per role; corner probabilities are the observed mass
// exactly at 0 / 50 / 100.
//
// BASE-RATE NEGLECT — no separate shift is added. The json's
// base_rate_neglect_stable_shift is mean(bet − 100·posterior) on Stable rounds; it
// is an ALTERNATIVE way to inject the bias for a site that draws bets straight from
// 100·posterior. Our reaction line is fit on bet ~ 100·posterior over ALL rounds,
// so its intercept already absorbs that over-placement (on a Stable draw the low
// posterior maps to intercept + slope·low ≈ posterior + ~17/23 pts). Adding the
// shift on top would double-count it, exactly the trap the brief warns against.
const WAVE1_PARAMS = {
  wave: 'prolific_wave1_2026-08-23',
  n_completers: 10,
  roles: {
    NOVICE: { slope: 1.3151, intercept: 10.7137, residualSd: 24.847,
              corner0: 0.0333, corner50: 0.0167, corner100: 0.0333 },
    EXPERT: { slope: 0.3967, intercept: 30.9778, residualSd: 21.396,
              corner0: 0,      corner50: 0.0250, corner100: 0.0083 },
  },
};

// 'rational' = current unchanged engine; 'data' = wave-1 stated bets.
let agentMode = (() => {
  const act = document.querySelector('#seg-agentmode button.active');
  return act ? act.dataset.mode : 'rational';
})();
let cornerLumps = true;

// Posterior mass on the Growing (positive-β) candidate(s) for one card's data.
// In the pilot's two-state design this is P(Growing | data); with a 3-state grid
// it is the total mass on β > 0.
function pGrowingOf(betaHat, se, sortedBetas, priors) {
  const post = posteriorOverCandidates(betaHat, se, sortedBetas, priors);
  let p = 0;
  for (let i = 0; i < sortedBetas.length; i++) if (sortedBetas[i] > 1e-9) p += post[i];
  return p;
}

// One member's STATED bet (points on Growing, 0–100) under the wave-1 model.
// Deterministic in `seed` so it is stable across ρ drags and view switches (the
// draw only changes on a Go press). Corner lumps, when on, replace the reaction
// draw with an exact 0/50/100 at the empirical probabilities.
function statedBetForMember(role, pGrowing, seed) {
  const rp = WAVE1_PARAMS.roles[role] || WAVE1_PARAMS.roles.NOVICE;
  const rng = mulberry32(seed >>> 0);
  if (cornerLumps) {
    const u = rng();
    if (u < rp.corner0) return 0;
    if (u < rp.corner0 + rp.corner50) return 50;
    if (u < rp.corner0 + rp.corner50 + rp.corner100) return 100;
  }
  const norm = makeNormal(rng);
  const bet = rp.intercept + rp.slope * (100 * pGrowing) + rp.residualSd * norm();
  return Math.max(0, Math.min(100, bet));
}

// Show/hide the data-driven-only elements and dim the rational-only analytic
// panels. Called on mode change and once on load.
function applyModeUI() {
  const dataMode = agentMode === 'data';
  document.body.classList.toggle('mode-data', dataMode);
  document.querySelectorAll('.dd-only').forEach(el => { el.hidden = !dataMode; });
}

// ============ Compute / render ============

function recompute(silent) {
  const { errs, betas, sigma, nN, nE } = validate();
  if (errs.length) {
    $('err').textContent = 'fix: ' + Array.from(new Set(errs)).join(', ');
    return null;
  }
  $('err').textContent = '';
  syncGrowthSeg();

  // Pair each candidate with its prior before sorting so priors stay aligned
  // to their β after the sort.
  const priors = readPriors(candCount);
  const order = betas.map((b, i) => ({ b, p: priors[i] }));
  order.sort((u, v) => u.b - v.b);
  const sortedBetas = order.map(o => o.b);
  const sortedPriors = order.map(o => o.p);
  // σ for everything on the analysis side: inflated by the rounding variance
  // when y is integer-valued, so the analytics describe the dots as drawn.
  const sigmaAn = analysisSigma(sigma);
  // Rebuild the random-x SE cache (no-op in fixed mode). Fresh MC seed per Go
  // press makes mode-switching/redraws visibly resample the design.
  rebuildSeCache(sigmaAn, [nN, nE], Math.floor(Math.random() * 1e9));
  const seN = effectiveSe(sigmaAn, nN);
  const seE = effectiveSe(sigmaAn, nE);
  const bs = bins(sortedBetas);

  const rows = sortedBetas.map((mu, i) => {
    const [a, b] = bs[i];
    return {
      mu, a, b,
      errN: errProbX(a, b, mu, nN, sigmaAn),
      errE: errProbX(a, b, mu, nE, sigmaAn),
      confN: avgConfX(a, b, mu, nN, sigmaAn),
      confE: avgConfX(a, b, mu, nE, sigmaAn),
    };
  });

  // Prior-weighted aggregation across candidates (priors sum to 1), replacing
  // the previous equal weighting.
  const avgErrN = rows.reduce((s, r, i) => s + sortedPriors[i] * r.errN, 0);
  const avgErrE = rows.reduce((s, r, i) => s + sortedPriors[i] * r.errE, 0);
  const avgConfN = rows.reduce((s, r, i) => s + sortedPriors[i] * r.confN, 0);
  const avgConfE = rows.reduce((s, r, i) => s + sortedPriors[i] * r.confE, 0);

  // Bayes-optimal (MAP / posterior-mode) average error per role. Same prior
  // weighting as the nearest-candidate average; lower because it uses the prior.
  const avgErrMapN = mapAvgErrorX(sortedBetas, sortedPriors, nN, sigmaAn);
  const avgErrMapE = mapAvgErrorX(sortedBetas, sortedPriors, nE, sigmaAn);

  $('head-nov').textContent = pct(avgErrN);
  $('head-exp').textContent = pct(avgErrE);
  $('head-nov-map').textContent = pct(avgErrMapN);
  $('head-exp-map').textContent = pct(avgErrMapE);

  renderTable(sortedBetas, sortedPriors, rows, avgErrN, avgErrE, avgConfN, avgConfE);
  drawPlot('plot', sortedBetas, bs, seN, seE, sigmaAn, nN, nE);
  lastRender = { sortedBetas, bs, seN, seE, sigma: sigmaAn, nN, nE };
  renderExamples(sortedBetas, sigma, sigmaAn, nE, nN, sortedPriors);

  if (!silent) {
    console.log('--- Error Rate Explorer ---');
    console.log('candidates (sorted):', sortedBetas);
    console.log('priors:', sortedPriors);
    console.log(`sigma = ${sigma}   y = ${intMode ? 'integers (analysis sigma ' + sigmaAn.toFixed(4) + ')' : 'continuous'}   x = ${xMode}, 0..${WINDOW_YEARS}`);
    console.log(`NOVICE n=${nN}  SE=${seN.toFixed(4)}  avgErr(nearest)=${(avgErrN*100).toFixed(2)}%  avgErr(MAP)=${(avgErrMapN*100).toFixed(2)}%  avgConf=${(avgConfN*100).toFixed(2)}%`);
    console.log(`EXPERT n=${nE}  SE=${seE.toFixed(4)}  avgErr(nearest)=${(avgErrE*100).toFixed(2)}%  avgErr(MAP)=${(avgErrMapE*100).toFixed(2)}%  avgConf=${(avgConfE*100).toFixed(2)}%`);
    rows.forEach(r => {
      console.log(`  beta=${r.mu.toFixed(4)}  bin=[${fmtBin(r.a)}, ${fmtBin(r.b)}]  errN=${(r.errN*100).toFixed(2)}%  errE=${(r.errE*100).toFixed(2)}%  confN=${(r.confN*100).toFixed(2)}%  confE=${(r.confE*100).toFixed(2)}%`);
    });
    if (xMode !== 'fixed') {
      console.log(`--- xMode = ${xMode}: headline error rates / sampling PDFs average over x ~ Uniform(0, ${WINDOW_YEARS}) ---`);
    }
  }

  return { rows, sortedBetas, seN, seE };
}

function pct(x) { return (x * 100).toFixed(2) + '%'; }

function fmtBin(v) {
  if (v === Infinity) return '+inf';
  if (v === -Infinity) return '-inf';
  return v.toFixed(3);
}

function renderTable(sortedBetas, sortedPriors, rows, avgErrN, avgErrE, avgConfN, avgConfE) {
  const head = $('tbl-head');
  head.innerHTML = '<th></th>' +
    sortedBetas.map(b => `<th><i class="mvar">β</i> = ${fmtSigned(b)}</th>`).join('') +
    '<th>Average</th>';

  const ERR_TIP = 'err = mistake rate: how often the member misclassifies the true state (an objective frequency — being right)';
  const CONF_TIP = 'conf = avg confidence in the correct state: mean posterior probability placed on the true state (subjective certainty — feeling right)';
  const cell = (err, conf) =>
    `<td><div class="cell-err" title="${ERR_TIP}">${pct(err)}</div><div class="cell-conf" title="${CONF_TIP}">${pct(conf)}</div></td>`;
  const avgCell = (err, conf) =>
    `<td class="avg"><div class="cell-err" title="${ERR_TIP}">${pct(err)}</div><div class="cell-conf" title="${CONF_TIP}">${pct(conf)}</div></td>`;

  // Prior / sampling row: P(β) weights that combine the per-β columns into the
  // AVERAGE column. The Average cell shows their sum (1.00 by construction).
  const priorSum = sortedPriors.reduce((s, p) => s + p, 0);
  const priorRow = '<td class="role-prior">prior <i class="mvar">π</i></td>' +
    sortedPriors.map(p => `<td class="cell-prior">${p.toFixed(2)}</td>`).join('') +
    `<td class="avg cell-prior">${priorSum.toFixed(2)}</td>`;

  const novRow = '<td class="role-novice">NOVICE</td>' +
    rows.map(r => cell(r.errN, r.confN)).join('') +
    avgCell(avgErrN, avgConfN);
  const expRow = '<td class="role-expert">EXPERT</td>' +
    rows.map(r => cell(r.errE, r.confE)).join('') +
    avgCell(avgErrE, avgConfE);

  $('tbl-body').innerHTML = `<tr class="prior-row">${priorRow}</tr><tr>${novRow}</tr><tr>${expRow}</tr>`;
}

// ============ Plot ============

// Canvas backing stores cost css-w × css-h × scale² × 4 bytes and WebKit
// reclaims them lazily; at devicePixelRatio 3 a large plot is a multi-MB GPU
// buffer per (re)draw. Cap the scale at 2 (visually indistinguishable for
// charts) and hard-cap total backing pixels so no canvas can balloon.
const MAX_BACKING_SCALE = 2;
const MAX_BACKING_PIXELS = 8_000_000; // ≈32MB RGBA, far above any sane chart
function backingScale(w, h) {
  let s = Math.min(window.devicePixelRatio || 1, MAX_BACKING_SCALE);
  if (w * h * s * s > MAX_BACKING_PIXELS) {
    s = Math.max(1, Math.sqrt(MAX_BACKING_PIXELS / (w * h)));
  }
  return s;
}

function getCtx(id, aspect, fill) {
  const c = document.getElementById(id);
  const container = c.parentElement;
  const w = Math.floor(container.clientWidth);
  let h = Math.floor(w / (aspect || 2.6));
  // ITEM A: when the card is stretched to match the table, fill the available
  // height instead of using the aspect ratio (falls back to aspect on mobile /
  // before layout settles, where clientHeight isn't meaningfully larger).
  if (fill) {
    const avail = Math.floor(container.clientHeight);
    if (avail > h) h = avail;
  }
  const dpr = backingScale(w, h);
  c.width = w * dpr;
  c.height = h * dpr;
  c.style.width = w + 'px';
  c.style.height = h + 'px';
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.W = w;
  ctx.H = h;
  return ctx;
}

function drawPlot(canvasId, sortedBetas, bs, seN, seE, sigma, nN, nE) {
  // Aspect 2.6 / 0.6 ≈ 4.33 = squished to 60% of original height; fill the
  // stretched card height when there's extra room (ITEM A).
  const ctx = getCtx(canvasId, 2.6 / 0.6, true);
  const W = ctx.W, H = ctx.H;
  const pad = { top: 38, right: 28, bottom: 50, left: 46 };
  const pw = W - pad.left - pad.right;
  const ph = H - pad.top - pad.bottom;

  ctx.clearRect(0, 0, W, H);

  // In random-x mode the SE-arrays bound the worst case; use the smallest
  // realised SE for y-max so we cover the tallest mixture component.
  const seArrN = seCache.arrs[nN], seArrE = seCache.arrs[nE];
  const seMin = (seArrN && seArrE)
    ? Math.min(seArrN.reduce((m,v)=>Math.min(m,v), Infinity),
               seArrE.reduce((m,v)=>Math.min(m,v), Infinity))
    : Math.min(seN, seE);
  const seMax = Math.max(seN, seE);
  const xLo = Math.min(...sortedBetas) - 4 * seMax;
  const xHi = Math.max(...sortedBetas) + 4 * seMax;
  const yMax = (1 / seMin / Math.sqrt(2 * Math.PI)) * 1.10;

  const tx = (v) => pad.left + (v - xLo) / (xHi - xLo) * pw;
  const ty = (v) => pad.top + (1 - v / yMax) * ph;

  // Light grid
  ctx.strokeStyle = '#f1f5f9';
  ctx.lineWidth = 1;
  const xStep = niceStep((xHi - xLo) / 8);
  for (let v = Math.ceil(xLo / xStep) * xStep; v <= xHi; v += xStep) {
    ctx.beginPath(); ctx.moveTo(tx(v), pad.top); ctx.lineTo(tx(v), pad.top + ph); ctx.stroke();
  }

  // X axis
  ctx.strokeStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top + ph);
  ctx.lineTo(pad.left + pw, pad.top + ph);
  ctx.stroke();

  // X tick labels
  ctx.fillStyle = '#94a3b8';
  ctx.font = '11px ' + getComputedStyle(document.body).fontFamily;
  ctx.textAlign = 'center';
  for (let v = Math.ceil(xLo / xStep) * xStep; v <= xHi; v += xStep) {
    ctx.fillText(formatTick(v), tx(v), pad.top + ph + 16);
  }

  // Bin boundaries (dashed)
  const innerBoundaries = [];
  for (let i = 0; i < bs.length - 1; i++) innerBoundaries.push(bs[i][1]);
  ctx.strokeStyle = '#475569';
  ctx.setLineDash([5, 4]);
  innerBoundaries.forEach(b => {
    if (b > xLo && b < xHi) {
      ctx.beginPath();
      ctx.moveTo(tx(b), pad.top);
      ctx.lineTo(tx(b), pad.top + ph);
      ctx.stroke();
    }
  });
  ctx.setLineDash([]);
  ctx.fillStyle = '#475569';
  ctx.font = '10px ' + getComputedStyle(document.body).fontFamily;
  innerBoundaries.forEach(b => {
    if (b > xLo && b < xHi) ctx.fillText(b.toFixed(3), tx(b), pad.top - 6);
  });

  const roles = [
    { name: 'NOVICE', n: nN, color: '#dc2626', shade: 'rgba(220,38,38,0.18)' },
    { name: 'EXPERT', n: nE, color: '#2563eb', shade: 'rgba(37,99,235,0.18)' },
  ];

  const nPts = 400;
  // Pre-evaluate p(x | β = mu) on the plotting grid. mixturePdf transparently
  // returns the fixed-x normal or the random-x mixture depending on xMode.
  const grid = new Float64Array(nPts + 1);
  for (let i = 0; i <= nPts; i++) grid[i] = xLo + (xHi - xLo) * i / nPts;
  const densByRoleAndK = roles.map(role =>
    sortedBetas.map(mu => {
      const arr = new Float64Array(nPts + 1);
      for (let i = 0; i <= nPts; i++) arr[i] = mixturePdf(grid[i], mu, role.n, sigma);
      return arr;
    })
  );

  // Shaded misclassification regions (back layer)
  roles.forEach((role, rIdx) => {
    sortedBetas.forEach((mu, k) => {
      const [a, b] = bs[k];
      const dens = densByRoleAndK[rIdx][k];
      ctx.fillStyle = role.shade;
      let started = false;
      for (let i = 0; i <= nPts; i++) {
        const xv = grid[i];
        const inside = (xv >= a) && (xv <= b);
        if (inside) {
          if (started) {
            ctx.lineTo(tx(xv), ty(0));
            ctx.closePath();
            ctx.fill();
            started = false;
          }
          continue;
        }
        const yv = dens[i];
        if (!started) {
          ctx.beginPath();
          ctx.moveTo(tx(xv), ty(0));
          started = true;
        }
        ctx.lineTo(tx(xv), ty(yv));
      }
      if (started) {
        ctx.lineTo(tx(xHi), ty(0));
        ctx.closePath();
        ctx.fill();
      }
    });
  });

  // PDF curves
  roles.forEach((role, rIdx) => {
    sortedBetas.forEach((mu, k) => {
      const dens = densByRoleAndK[rIdx][k];
      ctx.strokeStyle = role.color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let i = 0; i <= nPts; i++) {
        const xv = grid[i];
        const yv = dens[i];
        if (i === 0) ctx.moveTo(tx(xv), ty(yv));
        else ctx.lineTo(tx(xv), ty(yv));
      }
      ctx.stroke();
    });
  });

  // Candidate ticks + labels
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1.5;
  sortedBetas.forEach(mu => {
    const px = tx(mu);
    ctx.beginPath();
    ctx.moveTo(px, pad.top + ph);
    ctx.lineTo(px, pad.top + ph + 6);
    ctx.stroke();
  });
  ctx.fillStyle = '#1e293b';
  ctx.font = 'bold 11px ' + getComputedStyle(document.body).fontFamily;
  sortedBetas.forEach(mu => {
    ctx.fillText('β=' + fmtSigned(mu), tx(mu), pad.top + ph + 32);
  });

  // Title
  ctx.fillStyle = '#475569';
  ctx.font = 'bold 12px ' + getComputedStyle(document.body).fontFamily;
  ctx.textAlign = 'left';
  const titleSuffix = xMode === 'random'
    ? ` (averaged over x ~ U(0,${WINDOW_YEARS}))`
    : '';
  ctx.fillText('Sampling PDFs of β̂ — shaded mass = misclassification' + titleSuffix, pad.left, 18);
}

function niceStep(rawStep) {
  const exp = Math.floor(Math.log10(rawStep));
  const base = rawStep / Math.pow(10, exp);
  let nice;
  if (base < 1.5) nice = 1;
  else if (base < 3) nice = 2;
  else if (base < 7) nice = 5;
  else nice = 10;
  return nice * Math.pow(10, exp);
}

function formatTick(v) {
  if (Math.abs(v) < 1e-10) return '0';
  // β is a per-year slope (candidates 0.01–0.04), so ticks need 3 decimals.
  return v.toFixed(3);
}

// ============ Examples ============
// Fully dynamic: one row per user-typed candidate β. Each row = 1 EXPERT
// (n = nExpert input) + NOVICES (n = nNovice input). Data is sampled fresh from
// y = baseline + trueBeta * x + N(0, sigma^2) using a per-(row,member) seed, with
// its own integer baseline and — when the y-values toggle is on — integer y.

let N_NOVICES_PER_GROUP = 2;   // group size − 1 (1 EXPERT + this many NOVICES); set by #seg-size
const MONO_NSIMS = 100000;

function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function makeNormal(rng) {
  // Box-Muller, returns one standard normal draw per call.
  let cached = null;
  return function() {
    if (cached !== null) { const v = cached; cached = null; return v; }
    let u1; do { u1 = rng(); } while (u1 === 0);
    const u2 = rng();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    cached = r * Math.sin(theta);
    return r * Math.cos(theta);
  };
}

function linspaceArr(a, b, n) {
  if (n < 2) return [a];
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = a + (b - a) * i / (n - 1);
  return out;
}

function olsBetaHat(x, y) {
  let xbar = 0, ybar = 0;
  const n = x.length;
  for (let i = 0; i < n; i++) { xbar += x[i]; ybar += y[i]; }
  xbar /= n; ybar /= n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - xbar;
    num += dx * (y[i] - ybar);
    den += dx * dx;
  }
  return num / den;
}

// One member's series: its own integer baseline level, its own observation years,
// and the y values realised in those years. betaHat is fitted to the REALISED
// values, so with the y-values toggle on it is the slope through the rounded dots
// — never through the raw continuous draws behind them. (The baseline cancels out
// of the slope; it only puts the dots at a realistic height.)
function simulateMember(rowIdx, memberIdx, trueBeta, n, sigma, baseSeed) {
  const seed = baseSeed + rowIdx * 10 + memberIdx;
  const rng = mulberry32(seed);
  const norm = makeNormal(rng);
  const baseline = BASELINE_LO + Math.floor(rng() * (BASELINE_HI - BASELINE_LO + 1));
  let x;
  if (xMode === 'random') {
    x = new Array(n);
    for (let i = 0; i < n; i++) x[i] = X_SPAN * rng();
  } else {
    x = linspaceArr(0, X_SPAN, n);
  }
  const y = new Array(n);
  for (let i = 0; i < n; i++) y[i] = observe(baseline + trueBeta * x[i] + sigma * norm());
  return { x, y, baseline, betaHat: olsBetaHat(x, y) };
}

// Strict monotonicity rates + monotonicity index distribution of y at the
// NOVICE design. Uses a fresh base seed per Go press so MC noise is visible
// across runs (kept independent of card scatter seeds).
// The baseline is omitted here: it is an integer, and shifting a rounded series by
// an integer cannot change which steps go up. With integer y equal consecutive
// values are possible, and a flat step breaks a strictly monotone run (it counts
// as "not up") — as it should.
function monotonicityStats(rowIdx, trueBeta, n, sigma, nSims, baseSeed) {
  // In random-x mode "monotonic" means "monotonic when sorted by x", which is
  // how a viewer reads the scatter; we sample x ~ U(0, 100) per sim and sort.
  const fixedXs = linspaceArr(0, X_SPAN, n);
  const buckets = new Array(n).fill(0); // index k = sims with k upward jumps in (n-1) gaps
  let posCount = 0, negCount = 0;
  let upSum = 0;
  for (let s = 0; s < nSims; s++) {
    const seed = baseSeed + rowIdx * 1000000 + s;
    const rng = mulberry32(seed);
    const norm = makeNormal(rng);
    let xs;
    if (xMode === 'random') {
      xs = new Array(n);
      for (let i = 0; i < n; i++) xs[i] = X_SPAN * rng();
      xs.sort((a, b) => a - b);
    } else {
      xs = fixedXs;
    }
    let prev = observe(trueBeta * xs[0] + sigma * norm());
    let inc = true, dec = true;
    let upJumps = 0;
    for (let i = 1; i < n; i++) {
      const yi = observe(trueBeta * xs[i] + sigma * norm());
      if (yi > prev) upJumps++;
      if (yi <= prev) inc = false;
      if (yi >= prev) dec = false;
      prev = yi;
    }
    if (inc) posCount++;
    if (dec) negCount++;
    upSum += upJumps;
    buckets[upJumps]++;
  }
  const denom = n - 1;
  return {
    pos: posCount / nSims,
    neg: negCount / nSims,
    meanIndex: upSum / (nSims * denom),
    buckets: buckets.map(c => c / nSims),
  };
}

function nearestCandidate(value, candidates) {
  let best = candidates[0], bestD = Math.abs(value - candidates[0]);
  for (let i = 1; i < candidates.length; i++) {
    const d = Math.abs(value - candidates[i]);
    if (d < bestD) { best = candidates[i]; bestD = d; }
  }
  return best;
}

// Prior-weighted posterior over the candidate set for one card's observed data:
//   P(β_k | data) ∝ prior_k · φ((β̂ − β_k) / se),  renormalised across k.
// This is exactly what drawMiniPosterior plots as bars.
function posteriorOverCandidates(betaHat, se, sortedBetas, priors) {
  const pri = (priors && priors.length === sortedBetas.length)
    ? priors
    : sortedBetas.map(() => 1 / sortedBetas.length);
  const lik = sortedBetas.map(b => Math.exp(-0.5 * ((betaHat - b) / se) ** 2));
  const unnorm = lik.map((v, i) => pri[i] * v);
  const Z = unnorm.reduce((s, v) => s + v, 0);
  return unnorm.map(v => v / Z);
}

// "most likely" pick = posterior mode = argmax of the prior-weighted posterior
// (the tallest bar). Differs from "nearest" when the prior is uneven.
function posteriorModeCandidate(betaHat, se, sortedBetas, priors) {
  const post = posteriorOverCandidates(betaHat, se, sortedBetas, priors);
  let bi = 0;
  for (let i = 1; i < post.length; i++) if (post[i] > post[bi]) bi = i;
  return sortedBetas[bi];
}

// β is a per-year slope on a 0.01–0.04 scale, so 3 decimals (was 2 on the old
// ±0.2 scale) — β̂ draws land around ±0.05 and two decimals would flatten them.
function fmtSigned(v) {
  if (Math.abs(v) < 5e-4) return '0';
  return (v >= 0 ? '+' : '') + v.toFixed(3);
}

// sigma = the residual sd used to GENERATE the data (and to frame the scatters);
// sigmaAn = the sd the analysis uses (inflated by the rounding variance when y is
// integer-valued), so every SE / posterior / expected error below describes the
// dots as drawn.
function renderExamples(sortedBetas, sigma, sigmaAn, nExpert, nNovice, priors) {
  const host = $('example-groups');
  // Fresh base seeds per Go press for both the cards and the monotonicity MC,
  // drawn independently so the two streams don't alias.
  const cardBaseSeed = Math.floor(Math.random() * 1e9);
  const monoBaseSeed = Math.floor(Math.random() * 1e9);
  const groups = sortedBetas.map((trueBeta, rowIdx) => {
    const members = [];
    members.push(Object.assign(
      { role: 'EXPERT', n: nExpert },
      simulateMember(rowIdx, 0, trueBeta, nExpert, sigma, cardBaseSeed)
    ));
    for (let j = 0; j < N_NOVICES_PER_GROUP; j++) {
      members.push(Object.assign(
        { role: 'NOVICE', n: nNovice },
        simulateMember(rowIdx, j + 1, trueBeta, nNovice, sigma, cardBaseSeed)
      ));
    }
    // Data-driven stated bets: each member's posterior → P(Growing) → wave-1
    // reaction line + noise (+ corner lumps). Attached here so the ρ slider and
    // view switches re-pool the SAME draw without resampling. seObs uses sigmaAn
    // (the analysis σ), matching every other posterior on the page.
    members.forEach((m, mIdx) => {
      m.seObs = sigmaAn / Math.sqrt(ssOfX(m.x));
      m.pGrowing = pGrowingOf(m.betaHat, m.seObs, sortedBetas, priors);
      m.statedBet = statedBetForMember(m.role, m.pGrowing, cardBaseSeed + 500000 + rowIdx * 1000 + mIdx);
    });
    return { rowIdx, trueBeta, members };
  });

  host.innerHTML = groups.map(g => {
    const mono = monotonicityStats(g.rowIdx, g.trueBeta, nNovice, sigma, MONO_NSIMS, monoBaseSeed);
    const denom = nNovice - 1;
    const bucketLabels = mono.buckets.map((_, k) =>
      Math.round((k / denom) * 100) + '%'
    );
    const showBuckets = nNovice <= 8;
    return `
    <div class="group-card" data-rowidx="${g.rowIdx}">
      <div class="gc-head">
        <div class="gc-true">True <i class="mvar">β</i> = <span class="num">${fmtSigned(g.trueBeta)}</span></div>
        <div class="gc-comp">1 EXPERT <span class="sep">·</span> ${N_NOVICES_PER_GROUP} NOVICES <span class="sep">·</span> <span class="comp-n">n = ${nExpert} / ${nNovice}</span></div>
      </div>

      <!-- FOREGROUND: the aggregated group decision -->
      <div class="gc-decision" id="agg-${g.rowIdx}"></div>

      <!-- supporting: the member estimates being pooled -->
      <div class="gc-members">
        <div class="gc-members-head">
          <span class="gcm-label">Member estimates <span class="gcm-sub">— the slopes being pooled</span></span>
          <span class="nov-q-host pop-host">
            <button type="button" class="nov-q mini-info" aria-label="What do novices see on average?" aria-expanded="false">What do novices see on average?</button>
            <div class="info-popover pick-pop nov-pop" hidden>
              <p><b>What do novices see on average?</b> Each NOVICE sees only <i class="mvar">n</i>=${nNovice} points, so the data often looks cleanly trended by chance. Across ${MONO_NSIMS.toLocaleString()} simulated samples at true <i class="mvar">β</i>=${fmtSigned(g.trueBeta)}${intMode ? ' (integer y, so a flat step counts as "not up")' : ''}:</p>
              <div class="mono-stats">
                <div class="mono-stat"><span class="lab">monotonic ↑</span><span class="val">${(mono.pos*100).toFixed(1)}%</span></div>
                <div class="mono-stat"><span class="lab">monotonic ↓</span><span class="val">${(mono.neg*100).toFixed(1)}%</span></div>
                <div class="mono-stat"><span class="lab">mean index</span><span class="val">${(mono.meanIndex*100).toFixed(1)}%</span></div>
              </div>
              <p class="nov-pop-hint">how often a novice's points rise (or fall) in step with x — 50% index = no directional tendency.</p>
              ${showBuckets ? `
              <div class="mono-hist">
                <div class="mono-hist-title">% of gaps stepping up</div>
                ${mono.buckets.map((p, k) => `
                <div class="mono-bar-row">
                  <span class="mono-bar-lab">${bucketLabels[k]}</span>
                  <span class="mono-bar-track"><span class="mono-bar-fill" style="width:${(p*100).toFixed(1)}%"></span></span>
                  <span class="mono-bar-val">${(p*100).toFixed(1)}</span>
                </div>
                `).join('')}
              </div>
              ` : ''}
            </div>
          </span>
        </div>
        <div class="gc-members-body">
        <div class="example-row">
          ${g.members.map((m, j) => {
            const ssxR = ssOfX(m.x);
            const seR = sigmaAn / Math.sqrt(ssxR);
            const nearestPick = nearestCandidate(m.betaHat, sortedBetas);
            const mostLikelyPick = posteriorModeCandidate(m.betaHat, seR, sortedBetas, priors);
            return `
              <div class="example-card ${m.role.toLowerCase()}">
                <div class="example-header">
                  <span class="ex-role ${m.role.toLowerCase()}">${m.role}</span>
                  <span class="ex-meta">n = ${m.n}</span>
                </div>
                <canvas class="scatter" id="sc-${g.rowIdx}-${j}"></canvas>
                <canvas class="mini" id="mini-${g.rowIdx}-${j}"></canvas>
                <div class="example-stats">
                  <div class="stat-line"><span class="lab">true β</span><span class="val">${fmtSigned(g.trueBeta)}</span></div>
                  <div class="stat-line"><span class="lab">β̂</span><span class="val">${fmtSigned(m.betaHat)}</span></div>
                  <div class="stat-line"><span class="lab">baseline</span><span class="val">${m.baseline}</span></div>
                  <div class="stat-line"><span class="lab">SE</span><span class="val">${seR.toFixed(4)}</span></div>
                </div>
                ${agentMode === 'data' ? `
                <div class="dd-stated">
                  <div class="dd-stated-head">wave-1 stated bet <span class="dd-sub">— ${m.role === 'EXPERT' ? 'compresses' : 'overreacts'}</span></div>
                  <div class="dd-stated-body">
                    <span class="dd-bet ${m.statedBet >= 50 ? 'growing' : 'stable'}">${Math.round(m.statedBet)}<span class="dd-bet-u">/100 on Growing</span></span>
                    <span class="dd-lean">P(Growing)=${(m.pGrowing * 100).toFixed(0)}% → <b>${m.statedBet >= 50 ? 'Growing' : 'Stable'}</b></span>
                  </div>
                </div>` : ''}
                <div class="pick-block">
                  <div class="pick-head pop-host">
                    <span class="pick-head-lab">pick rule</span>
                    <button type="button" class="info-btn mini-info" aria-label="Why do the two pick rules differ?" aria-expanded="false">i</button>
                    <div class="info-popover pick-pop" hidden>The gap between these two is <b>base-rate neglect</b>. <b>nearest</b> ignores the prior (the base rate over the states); <b>most likely</b> (the Bayesian / posterior mode) uses it. When they disagree, choosing nearest over most likely means neglecting the base rate.</div>
                  </div>
                  <div class="pick-line pop-host">
                    <span class="lab">nearest<button type="button" class="info-btn mini-info" aria-label="What does nearest mean?" aria-expanded="false">i</button></span>
                    <span class="val pick-nearest">${fmtSigned(nearestPick)}</span>
                    <div class="info-popover pick-pop" hidden><b>nearest</b> = the candidate closest to the point estimate <i class="mvar">β</i>&#770;. Prior-free; flips at the midpoint between candidates.</div>
                  </div>
                  <div class="pick-line pop-host">
                    <span class="lab">most likely<button type="button" class="info-btn mini-info" aria-label="What does most likely mean?" aria-expanded="false">i</button></span>
                    <span class="val pick-likely">${fmtSigned(mostLikelyPick)}</span>
                    <div class="info-popover pick-pop" hidden><b>most likely</b> = highest posterior probability given the data <i>and</i> the prior, P(<i class="mvar">β</i>&nbsp;|&nbsp;data) ∝ prior × likelihood &mdash; the tallest bar above. With an uneven prior it switches further out, so it can differ from <b>nearest</b>.</div>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
        <!-- this specific draw → group pick under three fixed weightings -->
        <div class="realization-decision" id="real-${g.rowIdx}"></div>
        </div>
      </div>
    </div>
    `;
  }).join('');

  // Cache what the canvases need, then draw. A later view-switch can redraw
  // from this same snapshot so numbers stay fixed until the next Go press.
  lastExamples = { groups, sortedBetas, sigma, sigmaAn, priors };
  drawExampleCanvases(lastExamples);
  renderGroupDecisions(lastExamples);
  fillRealizationDecisions(lastExamples);
}

// ============ Group decision: aggregating member estimates ============
// Each group (1 EXPERT + 2 NOVICES) pools its members' OLS slope estimates into
// ONE group estimate, then maps to the nearest candidate. We report the EXPECTED
// group error rate (analytic, over the sampling distribution of that pooled
// estimate) under three weighting schemes. Pooled estimate with weights w_i:
//   β̄ = Σ w_i β̂_i / Σ w_i,  and since β̂_i ~ N(β, SE_i²) independently,
//   Var(β̄) = Σ w_i² SE_i² / (Σ w_i)²  ⇒  SE_group = √Var(β̄).
// Expected error = P(nearest(β̄) ≠ true candidate) for the true state, computed
// from the same nearest-candidate bins used everywhere else on the page.
function getRho() {
  const el = $('rho');
  const v = el ? parseFloat(el.value) : 0;
  // ρ ∈ [−1, 1]: 1 = optimal/precision, 0 = equal (⅓), <0 = counter-precision.
  return isFinite(v) ? Math.min(1, Math.max(-1, v)) : 0;
}

// Strength of a member's estimate = how far it lands from the central candidate,
// |β̂ − β_mid|. PURE STRENGTH: it ignores SE, so a noisy NOVICE who draws an
// extreme slope looks "strong" and gets over-weighted — anti-correlated with the
// true precision. (Proposed measure; alternatives noted in the UI.)
function midCandidate(sortedBetas) {
  // centre of the candidate range (0 for a symmetric grid).
  return (sortedBetas[0] + sortedBetas[sortedBetas.length - 1]) / 2;
}
function strengthWeights(members, sortedBetas) {
  const mid = midCandidate(sortedBetas);
  // small floor so an all-at-centre draw doesn't divide by zero
  return members.map(m => Math.max(Math.abs(m.betaHat - mid), 1e-6));
}

function pooledGroupError(members, weights, sortedBetas, trueBeta) {
  let sw = 0, swb = 0, swwse2 = 0;
  members.forEach((m, i) => {
    const w = weights[i];
    sw += w; swb += w * m.betaHat; swwse2 += w * w * m.se * m.se;
  });
  const bbar = swb / sw;
  const seGroup = Math.sqrt(swwse2) / sw;
  const pick = nearestCandidate(bbar, sortedBetas);
  // true candidate owns bin bs[idx]; trueBeta is exactly a grid point.
  const bs = bins(sortedBetas);
  let idx = 0, bd = Infinity;
  sortedBetas.forEach((b, i) => { const d = Math.abs(b - trueBeta); if (d < bd) { bd = d; idx = i; } });
  const [a, b] = bs[idx];
  const err = errProb(a, b, trueBeta, seGroup);
  return { bbar, seGroup, pick, err, correct: Math.abs(pick - trueBeta) < 1e-9 };
}

function rhoRegime(rho) {
  if (rho >= 0.985) return 'optimal · precision weighting';
  if (rho <= -0.985) return 'counter-precision · over-trusts noise';
  if (Math.abs(rho) < 0.03) return 'equal weighting (⅓ each)';
  if (rho > 0) return 'between equal and optimal';
  return 'counter-precision · over-trusts noisy members';
}
function behaviouralName(rho) {
  if (rho >= 0.985) return 'Behavioural ≈ optimal';
  if (Math.abs(rho) < 0.03) return 'Behavioural = equal';
  if (rho < 0) return 'Counter-precision ρ=' + rho.toFixed(2);
  return 'Underweight ρ=' + rho.toFixed(2);
}

function renderGroupDecisions(state) {
  if (!state) return;
  const { groups, sortedBetas, sigmaAn } = state;
  const rho = getRho();
  const dataMode = agentMode === 'data';
  if ($('rho-val')) $('rho-val').textContent = 'ρ = ' + rho.toFixed(2);
  if ($('rho-regime')) $('rho-regime').textContent = rhoRegime(rho);

  const pctv = x => (x * 100).toFixed(1) + '%';
  const chip = ok => `<span class="gt-chip ${ok ? 'ok' : 'miss'}">${ok ? '✓ hit' : '✗ miss'}</span>`;
  const regime = rhoRegime(rho);

  groups.forEach(g => {
    const box = $('agg-' + g.rowIdx);
    if (!box) return;
    // Per-member realised SE and precision τ = 1/SE².
    const ms = g.members.map(m => {
      const se = sigmaAn / Math.sqrt(ssOfX(m.x));
      return { role: m.role, betaHat: m.betaHat, se, tau: 1 / (se * se) };
    });
    const tau = ms.map(m => m.tau);
    const wRho = ms.map(m => Math.pow(m.tau, rho));   // ρ<0 ⇒ counter-precision

    // EXPERT weight share under the current scheme (how much the group leans on the expert).
    const ei = ms.findIndex(m => m.role === 'EXPERT');
    const share = ws => { const s = ws.reduce((a, b) => a + b, 0); return ei >= 0 ? ws[ei] / s : 0; };
    const expWtRho = share(wRho);

    // Rational pooled benchmark: precision (inverse-variance = optimal) weighting → nearest candidate.
    const bench = pooledGroupError(ms, tau, sortedBetas, g.trueBeta);
    // Rational pool at the CURRENT ρ (the hero in rational mode).
    const ratRho = pooledGroupError(ms, wRho, sortedBetas, g.trueBeta);

    // Data-driven group OUTCOME: the ρ-weighted combination of member STATED bets
    // (0–100 on Growing), decided by which side of 50 the pooled view lands. This is
    // the hero in data mode and moves live as ρ is dragged.
    const bets = g.members.map(m => (typeof m.statedBet === 'number' ? m.statedBet : 50));
    const trueGrowing = g.trueBeta > 1e-9;
    const poolBet = ws => {
      let sw = 0, swb = 0;
      ws.forEach((w, i) => { sw += w; swb += w * bets[i]; });
      const v = swb / sw, grow = v >= 50;
      return { v, grow, correct: grow === trueGrowing };
    };
    const ddRho = poolBet(wRho);

    // HERO — the outcome the ρ slider drives, live and primary.
    const hero = dataMode
      ? `<div class="gcd-hero ${ddRho.correct ? 'ok' : 'miss'}">
           <div class="gcd-hero-lab">Group outcome <span class="gcd-hero-scheme">${regime}</span></div>
           <div class="gcd-hero-main">
             <span class="gcd-hero-num">${ddRho.v.toFixed(0)}</span><span class="gcd-hero-unit">/100 on Growing</span>
             <span class="gcd-hero-arrow">→</span>
             <span class="gcd-hero-pick">${ddRho.grow ? 'Growing' : 'Stable'}</span>
             ${chip(ddRho.correct)}
           </div>
           <div class="gcd-hero-foot">weighted pool of the members' stated confidences · expert weight ${pctv(expWtRho)}</div>
         </div>`
      : `<div class="gcd-hero ${ratRho.correct ? 'ok' : 'miss'}">
           <div class="gcd-hero-lab">Group outcome <span class="gcd-hero-scheme">${regime}</span></div>
           <div class="gcd-hero-main">
             <span class="gcd-hero-num">${pctv(ratRho.err)}</span><span class="gcd-hero-unit">expected error</span>
             <span class="gcd-hero-arrow">→</span>
             <span class="gcd-hero-pick">${fmtSigned(ratRho.pick)}</span>
             ${chip(ratRho.correct)}
           </div>
           <div class="gcd-hero-foot">pooled β̄ ${fmtSigned(ratRho.bbar)} → nearest candidate · expert weight ${pctv(expWtRho)}</div>
         </div>`;

    // BENCHMARK — rational precision pool, always visible for comparison (does not move with ρ).
    const benchHtml = `<div class="gcd-bench ${bench.correct ? 'ok' : 'miss'}">
        <div class="gcd-bench-lab">Rational benchmark <span class="gcd-bench-sub">precision-pooled</span></div>
        <div class="gcd-bench-main">
          <span class="gcd-bench-num">${pctv(bench.err)}</span><span class="gcd-bench-unit">expected error</span>
          <span class="gcd-bench-pick">β̄ ${fmtSigned(bench.bbar)} → <b>${fmtSigned(bench.pick)}</b></span>
          ${chip(bench.correct)}
        </div>
        <div class="gcd-bench-foot">${dataMode ? 'if members reported the truthful Bayesian posterior' : 'inverse-variance (optimal) weighting'}</div>
      </div>`;

    box.innerHTML = `
      <div class="gcd-head">
        <span class="gcd-title">Group decision</span>
        <span class="gcd-note">${dataMode
          ? 'drag ρ above — the outcome is the ρ-weighted pool of stated confidences, decided by side of 50'
          : 'drag ρ above — the group pools estimates by wᵢ ∝ τᵢ^ρ, then takes the nearest candidate'}</span>
      </div>
      <div class="gcd-primary">
        ${hero}
        ${benchHtml}
      </div>`;
  });
}

// Per-realisation group pick (the specific sampled draw shown by the cards),
// under three FIXED weightings — optimal (precision), equal (⅓), strength (|β̂|).
// Deterministic from this draw's estimates; does NOT depend on ρ.
function fillRealizationDecisions(state) {
  if (!state) return;
  const { groups, sortedBetas, sigmaAn } = state;
  groups.forEach(g => {
    const host = $('real-' + g.rowIdx);
    if (!host) return;
    const ms = g.members.map(m => {
      const se = sigmaAn / Math.sqrt(ssOfX(m.x));
      return { role: m.role, betaHat: m.betaHat, se };
    });
    const tau = ms.map(m => 1 / (m.se * m.se));
    const wEqual = ms.map(() => 1);
    const wStr = strengthWeights(ms, sortedBetas);

    // pooled point estimate β̄ = Σwβ̂/Σw, then nearest candidate (single draw).
    const pooled = ws => {
      let sw = 0, swb = 0; ms.forEach((m, i) => { sw += ws[i]; swb += ws[i] * m.betaHat; });
      const bbar = swb / sw;
      const pick = nearestCandidate(bbar, sortedBetas);
      return { bbar, pick, correct: Math.abs(pick - g.trueBeta) < 1e-9 };
    };
    const ei = ms.findIndex(m => m.role === 'EXPERT');
    const expWt = ws => { const s = ws.reduce((a, b) => a + b, 0); return ei >= 0 ? ws[ei] / s : 0; };
    const pctv = x => (x * 100).toFixed(0) + '%';

    const row = (cls, name, ws) => {
      const r = pooled(ws);
      return `
      <div class="rd-row ${cls} ${r.correct ? 'ok' : 'miss'}">
        <div class="rd-name">${name}</div>
        <div class="rd-body">
          <span class="rd-pick">β̄ ${fmtSigned(r.bbar)} → <b>${fmtSigned(r.pick)}</b></span>
          <span class="rd-chip ${r.correct ? 'ok' : 'miss'}">${r.correct ? '✓' : '✗'}</span>
        </div>
        <div class="rd-foot">expert wt ${pctv(expWt(ws))}</div>
      </div>`;
    };

    host.innerHTML = `
      <div class="rd-title">This draw → group pick</div>
      ${row('optimal', 'Optimal', tau)}
      ${row('equal', 'Equal (⅓)', wEqual)}
      ${row('strength', 'Strength', wStr)}
      <div class="rd-note">strength = |β̂ − centre|, ignores SE</div>`;
  });
}

function drawExampleCanvases({ groups, sortedBetas, sigma, sigmaAn, priors }) {
  // Draw canvases now that the DOM is in place.
  groups.forEach(g => {
    g.members.forEach((m, j) => {
      const seObs = sigmaAn / Math.sqrt(ssOfX(m.x));
      // Highlight the bar matching the "most likely" rule (posterior mode).
      const pick = posteriorModeCandidate(m.betaHat, seObs, sortedBetas, priors);
      drawScatter(`sc-${g.rowIdx}-${j}`, m.x, m.y, m.role, g.trueBeta, sigma, m.baseline);
      drawMiniPosterior(`mini-${g.rowIdx}-${j}`, m.betaHat, seObs, sortedBetas, pick, priors);
    });
  });
}

function drawScatter(canvasId, x, y, role, trueBeta, sigma, baseline) {
  const c = document.getElementById(canvasId);
  if (!c) return;
  const w = c.clientWidth || c.parentElement.clientWidth || 180;
  const h = 130;
  const dpr = backingScale(w, h);
  c.width = w * dpr; c.height = h * dpr;
  c.style.width = w + 'px'; c.style.height = h + 'px';
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  // Room on the left for the y tick labels and under the plot for the abstract
  // year labels (the series is one 100-year window, not calendar years).
  const pad = { top: 7, right: 7, bottom: 15, left: 25 };
  const pw = w - pad.left - pad.right;
  const ph = h - pad.top - pad.bottom;

  const xLo = -0.03 * X_SPAN, xHi = 1.03 * X_SPAN;
  // y is a level around this series' own baseline: baseline (+ the drift over the
  // window) ± 3σ, widened so an extreme realised dot can never fall outside.
  const lo = baseline + Math.min(0, trueBeta * X_SPAN);
  const hi = baseline + Math.max(0, trueBeta * X_SPAN);
  let yLo = lo - (3 * sigma + 1), yHi = hi + (3 * sigma + 1);
  for (let i = 0; i < y.length; i++) {
    if (y[i] - 1 < yLo) yLo = y[i] - 1;
    if (y[i] + 1 > yHi) yHi = y[i] + 1;
  }

  const tx = (v) => pad.left + (v - xLo) / (xHi - xLo) * pw;
  const ty = (v) => pad.top + (1 - (v - yLo) / (yHi - yLo)) * ph;

  const font = getComputedStyle(document.body).fontFamily;
  // Horizontal guides + y tick labels, so the realistic dot heights (and, with
  // integer y, the fact that the dots sit on whole numbers) are readable.
  ctx.font = '9px ' + font;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;
  const yStep = niceStep((yHi - yLo) / 3);
  const yDec = yStep < 1 ? 1 : 0;   // integer levels normally; decimals only for a tiny σ
  for (let v = Math.ceil(yLo / yStep) * yStep; v <= yHi; v += yStep) {
    ctx.strokeStyle = '#f1f5f9';
    ctx.beginPath();
    ctx.moveTo(pad.left, ty(v));
    ctx.lineTo(pad.left + pw, ty(v));
    ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(v.toFixed(yDec), pad.left - 3, ty(v));
  }
  ctx.textBaseline = 'alphabetic';

  // Abstract year labels: the window is "yr 0 … yr 100", never calendar years.
  ctx.textAlign = 'center';
  ctx.fillStyle = '#94a3b8';
  [0, 0.5, 1].forEach(f => {
    const yr = f * X_SPAN;
    ctx.fillText((f === 0 ? 'yr ' : '') + Math.round(yr), tx(yr), h - 4);
  });

  const color = role === 'EXPERT' ? 'rgba(37,99,235,0.78)' : 'rgba(220,38,38,0.78)';
  const r = x.length > 20 ? 2.4 : 4;
  ctx.fillStyle = color;
  for (let i = 0; i < x.length; i++) {
    ctx.beginPath();
    ctx.arc(tx(x[i]), ty(y[i]), r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMiniPosterior(canvasId, betaHat, se, sortedBetas, pickedValue, priors) {
  const c = document.getElementById(canvasId);
  if (!c) return;
  const w = c.clientWidth || c.parentElement.clientWidth || 240;
  const h = 90;
  const dpr = backingScale(w, h);
  c.width = w * dpr; c.height = h * dpr;
  c.style.width = w + 'px'; c.style.height = h + 'px';
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  // Confidence given THIS card's data: prior over the candidate set times the
  // Gaussian likelihood, posterior conditioned on the observed design through
  // se = σ/√SS_x(x_obs), then renormalised across candidates.
  //   P(β_k | data) ∝ prior_k · φ((β̂ − β_k) / se)
  const post = posteriorOverCandidates(betaHat, se, sortedBetas, priors);

  const pad = { top: 14, right: 8, bottom: 22, left: 8 };
  const pw = w - pad.left - pad.right;
  const ph = h - pad.top - pad.bottom;
  const k = sortedBetas.length;
  const gap = 6;
  const barW = (pw - gap * (k - 1)) / k;

  // Title
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px ' + getComputedStyle(document.body).fontFamily;
  ctx.textAlign = 'left';
  ctx.fillText('posterior over candidates', pad.left, 10);

  for (let i = 0; i < k; i++) {
    const x = pad.left + i * (barW + gap);
    const barH = post[i] * ph;
    const y = pad.top + ph - barH;
    const isPick = Math.abs(sortedBetas[i] - pickedValue) < 1e-9;

    // Bar
    ctx.fillStyle = isPick ? '#2563eb' : '#cbd5e1';
    ctx.fillRect(x, y, barW, barH);

    // Probability label above bar
    ctx.fillStyle = isPick ? '#1e3a8a' : '#475569';
    ctx.font = (isPick ? 'bold ' : '') + '10px ' + getComputedStyle(document.body).fontFamily;
    ctx.textAlign = 'center';
    ctx.fillText((post[i] * 100).toFixed(0) + '%', x + barW / 2, y - 2);

    // Candidate label below
    ctx.fillStyle = '#475569';
    ctx.font = '10px ' + getComputedStyle(document.body).fontFamily;
    ctx.fillText(fmtSigned(sortedBetas[i]), x + barW / 2, pad.top + ph + 12);
  }
}

// Redraw both views' canvases from the cached snapshot (no resampling).
// Used when a hidden view becomes visible and its canvases need real width.
function redrawAll() {
  if (lastRender) {
    const r = lastRender;
    drawPlot('plot', r.sortedBetas, r.bs, r.seN, r.seE, r.sigma, r.nN, r.nE);
  }
  if (lastExamples) drawExampleCanvases(lastExamples);
}

// Resize must NOT run recompute(): that re-runs the full Monte-Carlo pass
// (100k sims per candidate row) and rebuilds every group card and canvas from
// scratch. iOS Safari fires resize continuously while scrolling (URL-bar
// collapse) and macOS fires it throughout a window drag, so recompute-on-resize
// churned tens of MB of canvas backing stores per second — WebKit reclaims
// those lazily, which ballooned the WebContent process until the OS killed it.
// Instead: redraw the cached results at the new width, reusing the existing
// canvas elements, and skip height-only resizes (canvas layout is width-driven).
let resizeT, lastLayoutW = window.innerWidth;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    if (window.innerWidth === lastLayoutW) return;
    lastLayoutW = window.innerWidth;
    redrawAll();
  }, 150);
});

// ρ (scheme-c calibration) slider: rescore the group-decision boxes from the
// cached sample — no resimulation, so only the behavioural row moves.
(() => {
  const slider = $('rho');
  if (slider) slider.addEventListener('input', () => renderGroupDecisions(lastExamples));
  // Info popover for the aggregation schemes (click to toggle, outside/Esc to close).
  wireInfoPopover('rho-info-btn', 'rho-popover');
})();

window.addEventListener('load', () => { applyModeUI(); recompute(); });



/* ---- sticky header collapse: reveal compact title once the hero scrolls past ---- */
(function(){
  var sentinel = document.getElementById('hdr-sentinel');
  var topbar = document.getElementById('topbar');
  if(sentinel && topbar && 'IntersectionObserver' in window){
    new IntersectionObserver(function(entries){
      topbar.classList.toggle('is-stuck', !entries[0].isIntersecting);
    }, {threshold:0}).observe(sentinel);
  }
})();



/* ---- In-page nav: the two pills smooth-scroll to their sections (one
   continuous page now), and a scrollspy keeps the active pill in sync. ---- */
(function(){
  var NAV = Array.prototype.slice.call(document.querySelectorAll('.topbar nav a[data-nav]'));
  var sections = NAV.map(function(a){ return document.getElementById(a.getAttribute('data-nav')); })
                    .filter(Boolean);
  function setActive(id){
    NAV.forEach(function(a){ a.classList.toggle('active', a.getAttribute('data-nav') === id); });
  }
  // Native anchor jump handles the scroll (html{scroll-behavior:smooth} +
  // section scroll-margin-top clears the sticky bar); we just track the hash.
  NAV.forEach(function(a){
    a.addEventListener('click', function(){ setActive(a.getAttribute('data-nav')); });
  });
  // Scrollspy: highlight whichever section occupies the vertical middle.
  if('IntersectionObserver' in window && sections.length){
    var spy = new IntersectionObserver(function(entries){
      entries.forEach(function(e){ if(e.isIntersecting) setActive(e.target.id); });
    }, {rootMargin:'-45% 0px -50% 0px', threshold:0});
    sections.forEach(function(s){ spy.observe(s); });
  }
  // Honour a deep-link hash on load (e.g. index.html#sec-stimuli).
  var h = (location.hash || '').replace(/^#/, '');
  if(h){ var el = document.getElementById(h); if(el){ setActive(h); el.scrollIntoView(); } }
})();
