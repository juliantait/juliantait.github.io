/* ============================================================================
   Top-level navbar: "Simulated Groups" is the base page (always mounted); "Game"
   OPENS A FULL-SCREEN OVERLAY on top of it. The overlay (with its own ✕ / Esc)
   closes back to Simulated Groups. Nothing about the Simulated-Groups content
   changes. __gameOpen/__gameClose live in the Game script below; __gameSetActive
   lets the overlay's ✕/Esc sync the active pill back.
   ============================================================================ */
(function(){
  var links = Array.prototype.slice.call(document.querySelectorAll('.topbar nav a[data-view]'));
  function setActive(view){
    links.forEach(function(a){ a.classList.toggle('active', a.dataset.view === view); });
  }
  window.__gameSetActive = setActive;
  links.forEach(function(a){
    a.addEventListener('click', function(e){
      e.preventDefault();
      if (a.dataset.view === 'view-game'){
        if (window.__gameOpen) window.__gameOpen();
      } else {
        if (window.__gameClose) window.__gameClose();
        setActive('view-groups');
      }
    });
  });
})();



/* ============================================================================
   GAME — a playable copy of the REAL oTree task, Pilot 2 configuration.

   Every design number below is copied from the experiment repo (copies in
   _ai/otree_ref/templates/; line numbers refer to those files). Nothing is
   read from the Simulation panel any more: the game always runs the design
   participants ran.

   ┌──────────────────────────┬────────────────────┬───────────────────────────────────────────┐
   │ quantity                 │ value              │ source                                    │
   ├──────────────────────────┼────────────────────┼───────────────────────────────────────────┤
   │ prior P(stable),P(grow)  │ 0.5 / 0.5          │ settings.py:694  'prior': [0.5, 0.5]      │
   │ islands (story)          │ 1000 → 500 / 500   │ settings.py:195  islands_total=1000       │
   │ growth arms (per year)   │ 0.03 / 0.04        │ settings.py:695  beta_pairs [[0,.03],[0,.04]] │
   │   (participant wording)  │ +3 / +4 per 100 yr │ settings.py:181-182 (coconuts per century)│
   │ stable slope             │ 0                  │ settings.py:695  (first of each pair)     │
   │ noise SD sigma_eps       │ 2.0                │ settings.py:214  sigma_eps=2.0            │
   │ baseline (integer)       │ U{40..80}          │ settings.py:215-216; stimulus.py:81 randint│
   │ x window                 │ 0 … 100, even grid │ settings.py:223-225; stimulus.py:56-67    │
   │ trend centre t_mid       │ 50                 │ stimulus.py:80  (x_min + x_max) / 2       │
   │ displayed production     │ round(y) integers  │ stimulus.py:84  int(round(y))             │
   │ NOVICE dots              │ 3 (years 0/50/100) │ settings.py:700 'n_novice': [3]           │
   │ EXPERT dots              │ 20                 │ settings.py:701 'n_expert': [20]          │
   │ n per block              │ one n per block    │ settings.py:699 role_switch_n_mode        │
   │ blocks × rounds          │ 2 × 8 = 16         │ settings.py:697 role_switch_blocks=2; :288 rounds_per_block=8 │
   │ role switch, order       │ yes, random order  │ settings.py:696 role_switch=True; :649-651│
   │ y window                 │ baseline ± 10      │ settings.py:389 y_half_window=10; stimulus.py:231-239 │
   │ chart geometry           │ 480×340, m 52/18/34/44 │ stimulus.py:292-293                   │
   │ x padding                │ 5 % of window      │ stimulus.py:297                           │
   │ tick steps               │ _tick_step(span,6/8)│ stimulus.py:321-323, 256-261             │
   │ dots                     │ r 5, #2c6fbb, .75  │ stimulus.py:382-383                       │
   │ fitted line (examples)   │ #d1495b, 2.5       │ stimulus.py:370-377 (reveal only here)    │
   │ bet block point          │ 50                 │ settings.py:427 bet_block_point=50        │
   │ forced view              │ 2 s                │ settings.py:361 min_view_seconds=2        │
   │ lock note                │ "Look at the chart, unlocking in {s}s" │ __init__.py:40        │
   │ win chance               │ 1 − (1 − a/100)²   │ widget_allocation.html:101-104 (scoring.py)│
   │ prize per paid round     │ £0.50              │ settings.py:315 scoring_prize=0.50        │
   │ paid rounds              │ 2 of all rounds    │ settings.py:316 paid_rounds_total=2       │
   │ Bayesian posterior       │ LLR, centred data  │ stimulus.py:117-155 (sigma = sigma_eps)   │
   └──────────────────────────┴────────────────────┴───────────────────────────────────────────┘
   Python's round() is round-half-even and Math.round is half-up; the two differ
   only on an exact .5, which a continuous Gaussian draw hits with probability 0.

   SITE-ONLY (not in the experiment, kept on purpose): feedback after every
   round and an end summary comparing the player with the Bayesian ideal
   observer on the same charts, by role.
   ============================================================================ */
(function(){
  'use strict';

  var P = {
    prior: [0.5, 0.5],
    islandsTotal: 1000,
    arms: [0.03, 0.04],
    sigma: 2.0,
    baselineMin: 40, baselineMax: 80,
    xMin: 0, xMax: 100,
    nNovice: 3, nExpert: 20,
    blocks: 2, roundsPerBlock: 8,
    yHalfWindow: 10,
    blockPoint: 50,
    minViewSeconds: 2,
    scoringPrize: 0.50,
    paidRoundsTotal: 2
  };
  var TOTAL = P.blocks * P.roundsPerBlock;
  var LOCK_NOTE_TPL = 'Look at the chart, unlocking in {s}s';
  var CONFIDENCE_TPL = 'How confident are you that it is {type}?';
  var MSG_DIRECTION_MISSING = 'Choose "Stable" or "Growing" first, then set your bet with the slider.';
  var MSG_BET_MISSING = 'Now set your bet: move the slider to show how confident you are.';
  var TOAST_MS = 2600;

  function gid(id){ return document.getElementById(id); }

  // ---------------------------------------------------------------- maths ----
  function gauss(){                       // Box–Muller, N(0,1)
    var u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function randint(lo, hi){ return lo + Math.floor(Math.random() * (hi - lo + 1)); }
  // stimulus.make_x_grid, 'fixed_even'
  function xGrid(n){
    if (n === 1) return [(P.xMin + P.xMax) / 2];
    var step = (P.xMax - P.xMin) / (n - 1), xs = [];
    for (var i = 0; i < n; i++) xs.push(P.xMin + i * step);
    return xs;
  }
  // stimulus.sample_points
  function samplePoints(n, trueBeta){
    var xs = xGrid(n), tMid = (P.xMin + P.xMax) / 2;
    var baseline = randint(P.baselineMin, P.baselineMax);
    var ys = xs.map(function(x){ return Math.round(baseline + trueBeta * (x - tMid) + P.sigma * gauss()); });
    return { xs: xs, ys: ys, baseline: baseline };
  }
  function mean(a){ var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
  // stimulus.ols_slope_se (slope only)
  function olsSlope(xs, ys){
    var xb = mean(xs), yb = mean(ys), sxx = 0, sxy = 0;
    for (var i = 0; i < xs.length; i++){ sxx += (xs[i] - xb) * (xs[i] - xb); sxy += (xs[i] - xb) * (ys[i] - yb); }
    return sxx === 0 ? 0 : sxy / sxx;
  }
  // stimulus.log_likelihood_ratio + posterior_pos (baseline marginalised: centred data)
  function posteriorGrowing(xs, ys, pair){
    var xb = mean(xs), yb = mean(ys);
    function rss(b){ var s = 0; for (var i = 0; i < xs.length; i++){ var r = (ys[i] - yb) - b * (xs[i] - xb); s += r * r; } return s; }
    var llr = (rss(pair[0]) - rss(pair[1])) / (2 * P.sigma * P.sigma);
    var logOdds = llr + Math.log(P.prior[1] / P.prior[0]);
    if (logOdds > 700) return 1;
    return 1 / (1 + Math.exp(-logOdds));
  }
  // stimulus.noise_years_table (largest-remainder rounding to 100)
  function erf(x){
    var s = x < 0 ? -1 : 1; x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  function phi(z){ return 0.5 * (1 + erf(z / Math.SQRT2)); }
  function noiseYearsTable(sigma){
    var p0 = phi(0.5 / sigma) - phi(-0.5 / sigma), p1 = phi(1.5 / sigma) - phi(0.5 / sigma),
        p2 = phi(2.5 / sigma) - phi(1.5 / sigma), p3 = 1 - phi(2.5 / sigma);
    var raw = [p3, p2, p1, p0, p1, p2, p3].map(function(p){ return 100 * p; });
    var out = raw.map(Math.floor);
    var left = 100 - out.reduce(function(a, b){ return a + b; }, 0);
    var order = [0,1,2,3,4,5,6].sort(function(a, b){ return (raw[b] - out[b]) - (raw[a] - out[a]); });
    for (var k = 0; k < left; k++) out[order[k]] += 1;
    return out;
  }
  // scoring: binarised quadratic. a = points on the ACTUAL type (0–100) → percent
  function winPct(a){ return 100 - (100 - a) * (100 - a) / 100; }
  function winPctFor(betGrow, trueGrow){ return winPct(trueGrow ? betGrow : 100 - betGrow); }
  function expWinPct(betGrow, pGrow){ return pGrow * winPctFor(betGrow, true) + (1 - pGrow) * winPctFor(betGrow, false); }

  // ------------------------------------------------- chart (stimulus.py) ----
  function fmt(v){ var s = v.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); return (s === '' || s === '-0') ? '0' : s; }
  function tickStep(span, maxTicks){
    var steps = [1, 2, 5, 10, 20, 25, 50, 100];
    for (var i = 0; i < steps.length; i++) if (span / steps[i] <= maxTicks) return steps[i];
    return span;
  }
  function yWindow(yCenter){ var c = Math.round(yCenter); return [c - P.yHalfWindow, c + P.yHalfWindow]; }
  // Exact port of stimulus.scatter_svg(xs, ys, cfg, y_center=baseline, plot_id='task'),
  // plus show_fit (the instructions-example line) used here only on the reveal.
  function scatterSvg(xs, ys, yCenter, showFit){
    var W = 480, H = 340, ml = 52, mr = 18, mt = 34, mb = 44;
    var pw = W - ml - mr, ph = H - mt - mb;
    var pad = 0.05 * (P.xMax - P.xMin), xlo = P.xMin - pad, xhi = P.xMax + pad;
    var yw = yWindow(yCenter), yLo = yw[0], yHi = yw[1];
    function px(x){ return ml + (x - xlo) / (xhi - xlo) * pw; }
    function py(y){ return mt + (yHi - y) / (yHi - yLo) * ph; }
    var F = 'font-family="system-ui,sans-serif"';
    var parts = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + fmt(W) + ' ' + fmt(H) + '" role="img" aria-label="Chart of one island\'s coconut production in ' + xs.length + ' recorded years" style="width:100%;height:auto;display:block;">',
      '<rect x="0" y="0" width="100%" height="100%" fill="#ffffff"/>',
      '<text x="' + fmt(W / 2) + '" y="21" text-anchor="middle" ' + F + ' font-size="16" font-weight="600" fill="#333">This island&#8217;s coconut production</text>'
    ];
    var xStep = tickStep(P.xMax - P.xMin, 6), xticks = [];
    for (var i = 0; i <= Math.floor((P.xMax - P.xMin) / xStep); i++) xticks.push(P.xMin + i * xStep);
    var yStep = tickStep(yHi - yLo, 8), yticks = [];
    for (var yt = yStep * Math.ceil(yLo / yStep); yt <= yHi; yt += yStep) yticks.push(yt);
    xticks.forEach(function(xt){
      var X = px(xt);
      parts.push('<line x1="' + fmt(X) + '" y1="' + fmt(mt) + '" x2="' + fmt(X) + '" y2="' + fmt(mt + ph) + '" stroke="#eceff3" stroke-width="1"/>');
      parts.push('<text x="' + fmt(X) + '" y="' + fmt(mt + ph + 19) + '" text-anchor="middle" ' + F + ' font-size="14" fill="#555">' + xt + '</text>');
    });
    yticks.forEach(function(v){
      var Y = py(v);
      parts.push('<line x1="' + fmt(ml) + '" y1="' + fmt(Y) + '" x2="' + fmt(ml + pw) + '" y2="' + fmt(Y) + '" stroke="#eceff3" stroke-width="1"/>');
      parts.push('<text x="' + fmt(ml - 9) + '" y="' + fmt(Y + 5) + '" text-anchor="end" ' + F + ' font-size="14" fill="#555">' + v + '</text>');
    });
    parts.push('<rect x="' + fmt(ml) + '" y="' + fmt(mt) + '" width="' + fmt(pw) + '" height="' + fmt(ph) + '" fill="none" stroke="#ccd5e0" stroke-width="1"/>');
    parts.push('<text x="' + fmt(ml + pw / 2) + '" y="' + fmt(H - 6) + '" text-anchor="middle" ' + F + ' font-size="15" fill="#333">Year</text>');
    parts.push('<text x="14" y="' + fmt(mt + ph / 2) + '" text-anchor="middle" ' + F + ' font-size="15" fill="#333" transform="rotate(-90 14 ' + fmt(mt + ph / 2) + ')">Coconuts</text>');
    // marks, CLIPPED to the plot frame (stimulus.py CLIP POLICY)
    parts.push('<clipPath id="clip-game"><rect x="' + fmt(ml) + '" y="' + fmt(mt) + '" width="' + fmt(pw) + '" height="' + fmt(ph) + '"/></clipPath>');
    parts.push('<g clip-path="url(#clip-game)">');
    if (showFit && xs.length >= 2){
      var bh = olsSlope(xs, ys), xb = mean(xs), yb = mean(ys), ic = yb - bh * xb;
      parts.push('<line x1="' + fmt(px(xlo)) + '" y1="' + fmt(py(ic + bh * xlo)) + '" x2="' + fmt(px(xhi)) + '" y2="' + fmt(py(ic + bh * xhi)) + '" stroke="#d1495b" stroke-width="2.5" stroke-linecap="round"/>');
    }
    for (var k = 0; k < xs.length; k++){
      parts.push('<circle cx="' + fmt(px(xs[k])) + '" cy="' + fmt(py(ys[k])) + '" r="5" fill="#2c6fbb" fill-opacity="0.75"/>');
    }
    parts.push('</g></svg>');
    return parts.join('');
  }
  window.__expertsScatterSvg = scatterSvg;   // used by the chart-parity check in _ai/

  // ------------------------------------------------------------ the game ----
  var game = null;      // { arm, pair, roleOrder, rounds:[…], idx, results:[…] }
  var bet = null;       // points on Growing, or null (unset)
  var direction = null; // null | 'STABLE' | 'GROWING'
  var viewLocked = false, revealed = false;
  var lockTimer = null, tickTimer = null, toastTimer = null;

  function newGame(){
    var arm = P.arms[Math.random() < 0.5 ? 0 : 1];
    var pair = [0, arm];
    var roleOrder = Math.random() < 0.5 ? ['NOVICE', 'EXPERT'] : ['EXPERT', 'NOVICE'];
    var rounds = [];
    for (var b = 0; b < P.blocks; b++){
      var role = roleOrder[b], n = role === 'EXPERT' ? P.nExpert : P.nNovice;
      for (var r = 1; r <= P.roundsPerBlock; r++){
        // stimulus.draw_true_beta: fresh state from the prior every round
        var trueBeta = Math.random() < P.prior[0] ? pair[0] : pair[1];
        var s = samplePoints(n, trueBeta);
        rounds.push({ block: b + 1, roundInBlock: r, role: role, n: n, trueBeta: trueBeta,
                      trueGrow: trueBeta === pair[1], xs: s.xs, ys: s.ys, baseline: s.baseline,
                      posterior: posteriorGrowing(s.xs, s.ys, pair) });
      }
    }
    game = { arm: arm, pair: pair, roleOrder: roleOrder, rounds: rounds, idx: 0, results: [] };
  }
  function armCoconuts(){ return Math.round(game.arm * (P.xMax - P.xMin)); }

  function show(id){
    ['game-intro', 'game-block', 'game-panel', 'game-summary'].forEach(function(s){ gid(s).hidden = (s !== id); });
    var ov = gid('game-overlay'); if (ov) ov.scrollTop = 0;
  }

  // ---- intro ----
  function renderIntro(){
    var t = noiseYearsTable(P.sigma);
    gid('gi-noise0').textContent = t[3]; gid('gi-noise1').textContent = t[2];
    gid('gi-noise2').textContent = t[1]; gid('gi-noise3').textContent = t[0];
    gid('gi-nstable').textContent = Math.round(P.prior[0] * P.islandsTotal);
    gid('gi-ngrow').textContent = Math.round(P.prior[1] * P.islandsTotal);
    gid('gi-arm').textContent = armCoconuts();
    gid('gi-arm2').textContent = '+' + armCoconuts();
  }
  function showIntro(){ newGame(); renderIntro(); show('game-intro'); }

  // ---- block start (main/BlockStart.html) ----
  function showBlockStart(){
    var r = game.rounds[game.idx], first = r.block === 1;
    gid('gb-eyebrow').textContent = 'Part ' + r.block + ' of ' + P.blocks;
    gid('gb-title').textContent = first ? 'Ready to start' : 'Next part';
    gid('gb-text').innerHTML = first
      ? 'This is the start of the game. In the first part you will see <strong>' + P.roundsPerBlock + '</strong> islands.'
      : 'You have finished part <strong>' + (r.block - 1) + '</strong>. In the next part you will see <strong>' + P.roundsPerBlock + '</strong> islands. <strong>The number of years with surviving records has changed</strong> for the next ' + P.roundsPerBlock + ' rounds.';
    show('game-block');
  }

  // ---- the two-step bet widget (elicit.js behaviour) ----
  function renderWidget(){
    var root = gid('bet_widget'), gated = !direction;
    root.classList.toggle('bet-dir-stable', direction === 'STABLE');
    root.classList.toggle('bet-dir-growing', direction === 'GROWING');
    root.classList.toggle('bet-unset', bet === null);
    gid('bet_gate').classList.toggle('is-gated', gated);
    var slider = gid('allocation_pos_pct');
    if (gated) slider.setAttribute('aria-disabled', 'true'); else slider.removeAttribute('aria-disabled');
    gid('bet_shield').hidden = !(gated && !viewLocked && !revealed);
    var st = gid('bet_step2_text');
    if (gated) st.classList.remove('is-visible');
    else { st.textContent = CONFIDENCE_TPL.replace('{type}', direction === 'GROWING' ? 'growing' : 'stable'); st.classList.add('is-visible'); }
    gid('pts_pos').textContent = bet === null ? '—' : String(bet);
    gid('pts_zero').textContent = bet === null ? '—' : String(100 - bet);
    slider.setAttribute('aria-valuetext', bet === null ? 'No bet set yet' : (100 - bet) + ' points on Stable, ' + bet + ' points on Growing');
  }
  function showToast(){
    var t = gid('bet_toast');
    t.hidden = false; t.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ t.classList.remove('is-visible'); t.hidden = true; }, TOAST_MS);
  }
  function applyDirection(value){
    if (revealed || viewLocked) return;
    direction = value;
    bet = null;                                  // cleared, never mirrored
    gid('allocation_pos_pct').value = P.blockPoint;
    gid('game-error').hidden = true;
    clearTimeout(toastTimer); gid('bet_toast').classList.remove('is-visible'); gid('bet_toast').hidden = true;
    renderWidget();
  }
  function onSlider(){
    if (revealed || viewLocked) return;
    var s = gid('allocation_pos_pct');
    if (!direction){ s.value = P.blockPoint; showToast(); return; }
    var v = parseInt(s.value, 10);
    v = direction === 'GROWING' ? Math.max(P.blockPoint, v) : Math.min(P.blockPoint, v);
    s.value = v; bet = v;
    gid('game-error').hidden = true;
    renderWidget();
  }
  function resetWidget(){
    direction = null; bet = null;
    document.querySelectorAll('#bet_direction input').forEach(function(r){ r.checked = false; r.disabled = false; });
    var s = gid('allocation_pos_pct'); s.value = P.blockPoint; s.disabled = false;
    gid('bet_opt').hidden = true;
    gid('bet_toast').hidden = true;
    gid('info_panel').classList.remove('open'); gid('info_btn').setAttribute('aria-expanded', 'false');
    renderWidget();
  }

  // ---- forced minimum viewing time (AllocationScreen.html) ----
  function startViewLock(){
    clearTimeout(lockTimer); clearInterval(tickTimer);
    var secs = P.minViewSeconds, note = gid('game-lock-note'), half = gid('game-elicit'), btn = gid('game-submit');
    var msg = function(s){ return LOCK_NOTE_TPL.replace('{s}', s); };
    gid('game-lock-balance').textContent = msg(secs);
    if (!(secs > 0)){ viewLocked = false; note.classList.remove('is-visible'); return; }
    viewLocked = true;
    half.classList.add('locked'); btn.disabled = true;
    note.textContent = msg(secs); note.classList.add('is-visible');
    var remaining = secs;
    tickTimer = setInterval(function(){ remaining -= 1; if (remaining > 0) note.textContent = msg(remaining); }, 1000);
    lockTimer = setTimeout(function(){
      clearInterval(tickTimer);
      viewLocked = false;
      half.classList.remove('locked'); btn.disabled = false;
      note.classList.remove('is-visible');
      renderWidget();
    }, secs * 1000);
    renderWidget();
  }

  // ---- a round ----
  function showRound(){
    var r = game.rounds[game.idx];
    revealed = false;
    gid('game-progress').innerHTML = 'Part ' + r.block + ' of ' + P.blocks + '<span class="sep">&middot;</span>Round ' + r.roundInBlock + ' of ' + P.roundsPerBlock;
    gid('game-progress-fill').style.width = Math.round(100 * (game.idx + 1) / TOTAL) + '%';
    gid('game-chart').innerHTML = scatterSvg(r.xs, r.ys, r.baseline, false);
    gid('game-elicit').classList.remove('revealed');
    gid('game-feedback').hidden = true;
    gid('game-error').hidden = true;
    gid('game-submit').textContent = 'Next island';
    resetWidget();
    show('game-panel');
    startViewLock();
  }

  function submit(){
    if (viewLocked || revealed) return;
    var err = gid('game-error');
    if (!direction){ err.textContent = MSG_DIRECTION_MISSING; err.hidden = false; return; }
    if (bet === null){ err.textContent = MSG_BET_MISSING; err.hidden = false; return; }
    err.hidden = true;
    revealed = true;
    var r = game.rounds[game.idx];
    var idealBet = Math.round(100 * r.posterior);
    var res = {
      role: r.role, n: r.n, trueGrow: r.trueGrow, posterior: r.posterior, bet: bet, direction: direction, idealBet: idealBet,
      you: winPctFor(bet, r.trueGrow), ideal: winPctFor(idealBet, r.trueGrow),
      youExp: expWinPct(bet, r.posterior), idealExp: expWinPct(idealBet, r.posterior)
    };
    game.results.push(res);
    revealFeedback(r, res);
  }

  function sideScore(b, trueGrow){ return b === 50 ? 0.5 : ((b > 50) === trueGrow ? 1 : 0); }

  function revealFeedback(r, res){
    gid('game-elicit').classList.add('revealed');
    document.querySelectorAll('#bet_direction input').forEach(function(x){ x.disabled = true; });
    gid('allocation_pos_pct').disabled = true;
    renderWidget();
    gid('game-chart').innerHTML = scatterSvg(r.xs, r.ys, r.baseline, true);
    // ideal observer's bet on the track (thumb centre travels 15px … 100%−15px)
    var m = gid('bet_opt');
    m.style.left = 'calc(15px + ' + (res.idealBet / 100) + ' * (100% - 30px))';
    m.querySelector('span').textContent = 'ideal ' + res.idealBet;
    m.hidden = false;

    var truthWord = r.trueGrow ? 'Growing (+' + armCoconuts() + ' coconuts every 100 years)' : 'Stable';
    var side = sideScore(res.bet, r.trueGrow);
    var cls = side === 1 ? 'ok' : side === 0 ? 'bad' : '';
    var actualYou = r.trueGrow ? res.bet : 100 - res.bet, actualIdeal = r.trueGrow ? res.idealBet : 100 - res.idealBet;
    gid('game-feedback').innerHTML =
      '<p class="fb-truth ' + cls + '">This island was ' + truthWord + '.</p>' +
      '<div class="fb-grid">' +
        '<span></span><span class="h">You</span><span class="h opt">Ideal observer</span>' +
        '<span>Points on Growing</span><span class="v">' + res.bet + '</span><span class="v opt">' + res.idealBet + '</span>' +
        '<span>Points on actual type</span><span class="v">' + actualYou + '</span><span class="v opt">' + actualIdeal + '</span>' +
        '<span>Chance of winning</span><span class="v">' + Math.round(res.you) + '%</span><span class="v opt">' + Math.round(res.ideal) + '%</span>' +
      '</div>' +
      '<p class="fb-note">Part ' + r.block + ' &middot; ' + r.role + ': ' + r.n + ' recorded years. The ideal observer (Bayes, same chart, 50/50 prior, &sigma; = 2) puts P(growing) at ' + (100 * r.posterior).toFixed(1) + '%. Red line: least-squares fit to the dots.</p>';
    gid('game-feedback').hidden = false;
    var last = game.idx === TOTAL - 1;
    gid('game-submit').textContent = last ? 'See results' : 'Continue';
  }

  function advance(){
    game.idx += 1;
    if (game.idx >= TOTAL){ showSummary(); return; }
    if (game.rounds[game.idx].roundInBlock === 1) showBlockStart(); else showRound();
  }

  // ---- summary (site-only) ----
  function agg(list){
    var n = list.length || 1, o = { k: list.length, you: 0, ideal: 0, youExp: 0, idealExp: 0, sideYou: 0, sideIdeal: 0 };
    list.forEach(function(r){
      o.you += r.you; o.ideal += r.ideal; o.youExp += r.youExp; o.idealExp += r.idealExp;
      o.sideYou += sideScore(r.bet, r.trueGrow); o.sideIdeal += sideScore(r.idealBet, r.trueGrow);
    });
    ['you','ideal','youExp','idealExp'].forEach(function(k){ o[k] /= n; });
    return o;
  }
  function showSummary(){
    var res = game.results;
    var all = agg(res);
    var rows = game.roleOrder.map(function(role){
      var a = agg(res.filter(function(r){ return r.role === role; }));
      var n = role === 'EXPERT' ? P.nExpert : P.nNovice;
      return '<tr><td>' + role + ' <span style="color:var(--ink-mute)">(' + n + ' yrs)</span></td><td>' + Math.round(a.you) + '%</td><td class="opt">' + Math.round(a.ideal) + '%</td><td>' + fmtSide(a.sideYou, a.k) + '</td><td class="opt">' + fmtSide(a.sideIdeal, a.k) + '</td></tr>';
    }).join('');
    // the experiment's payment draw: 2 rounds from all 16, each a lottery for £0.50
    var picks = [], pool = res.map(function(_, i){ return i; });
    for (var k = 0; k < Math.min(P.paidRoundsTotal, pool.length); k++) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    picks.sort(function(a, b){ return a - b; });
    var wonYou = 0, wonIdeal = 0;
    picks.forEach(function(i){ var u = 100 * Math.random(); if (u < res[i].you) wonYou += P.scoringPrize; if (u < res[i].ideal) wonIdeal += P.scoringPrize; });
    gid('game-summary-body').innerHTML =
      '<p class="section-text">The game ran the Pilot 2 design: growing islands gained <strong>' + armCoconuts() + ' coconuts per 100 years</strong>, and you played the ' + game.roleOrder[0] + ' part first. Your score in a round is your chance of winning (100 &minus; (100 &minus; <i>a</i>)<sup>2</sup>/100 with <i>a</i> points on the actual type). The <strong>ideal observer</strong> saw the same charts and bet its exact Bayesian posterior.</p>' +
      '<div class="sum-big">' +
        '<div class="sum-stat"><span class="v">' + Math.round(all.you) + '%</span><span class="k">your average chance of winning</span></div>' +
        '<div class="sum-stat"><span class="v opt">' + Math.round(all.ideal) + '%</span><span class="k">ideal observer, same charts</span></div>' +
      '</div>' +
      '<div class="sum-wrap"><table class="sum-table"><thead><tr><th>Part</th><th>You</th><th class="opt">Ideal</th><th>Right side (you)</th><th class="opt">Right side (ideal)</th></tr></thead><tbody>' + rows +
      '<tr class="all"><td>All 16</td><td>' + Math.round(all.you) + '%</td><td class="opt">' + Math.round(all.ideal) + '%</td><td>' + fmtSide(all.sideYou, all.k) + '</td><td class="opt">' + fmtSide(all.sideIdeal, all.k) + '</td></tr></tbody></table></div>' +
      '<p class="xp-hint">Luck matters in 16 rounds. Judged by the ideal observer&rsquo;s own beliefs, your bets were worth <strong>' + Math.round(all.youExp) + '%</strong> on average against its <strong>' + Math.round(all.idealExp) + '%</strong> (the most any bet can be worth on these charts). &ldquo;Right side&rdquo; counts a bet that leaned towards the actual type; 50/50 counts half.</p>' +
      '<p class="xp-hint">In the experiment, ' + P.paidRoundsTotal + ' random rounds pay: here rounds ' + picks.map(function(i){ return i + 1; }).join(' and ') + ' were drawn, each a lottery for £' + P.scoringPrize.toFixed(2) + ' at its chance of winning. Your bonus would have been <strong>£' + wonYou.toFixed(2) + '</strong> (ideal observer, same draws: £' + wonIdeal.toFixed(2) + ').</p>';
    show('game-summary');
  }
  function fmtSide(x, k){ return (x % 1 ? x.toFixed(1) : x) + ' / ' + k; }

  // ---- overlay open / close ----
  function stopTimers(){ clearTimeout(lockTimer); clearInterval(tickTimer); clearTimeout(toastTimer); viewLocked = false; }
  function openOverlay(){
    gid('game-overlay').hidden = false;
    document.body.classList.add('game-open');
    stopTimers();
    showIntro();                        // every entry starts a fresh game at the intro
    if (window.__gameSetActive) window.__gameSetActive('view-game');
  }
  function closeOverlay(){
    stopTimers();
    gid('game-overlay').hidden = true;
    document.body.classList.remove('game-open');
    if (window.__gameSetActive) window.__gameSetActive('view-groups');
  }
  window.__gameOpen = openOverlay;
  window.__gameClose = closeOverlay;
  if (location.hash === '#game') openOverlay();
  window.addEventListener('hashchange', function(){ if (location.hash === '#game') openOverlay(); });
  // read-only snapshot for E2E tests
  window.__gameState = function(){
    var r = game && game.rounds[game.idx];
    return {
      params: P, arm: game && game.arm, roleOrder: game && game.roleOrder, idx: game && game.idx,
      round: r ? { block: r.block, roundInBlock: r.roundInBlock, role: r.role, n: r.n, trueBeta: r.trueBeta,
                   baseline: r.baseline, xs: r.xs, ys: r.ys, posterior: r.posterior } : null,
      bet: { direction: direction, pts: bet }, viewLocked: viewLocked, revealed: revealed,
      results: game ? game.results.slice() : []
    };
  };

  // ---- wiring ----
  document.querySelectorAll('#bet_direction input').forEach(function(r){
    r.addEventListener('change', function(){ applyDirection(r.value); });
  });
  var slider = gid('allocation_pos_pct');
  slider.addEventListener('input', onSlider);
  slider.addEventListener('change', onSlider);
  slider.addEventListener('keydown', function(e){
    if (!direction && !revealed && !viewLocked){ e.preventDefault(); showToast(); }
  });
  gid('bet_shield').addEventListener('pointerdown', function(e){ e.preventDefault(); showToast(); });
  gid('info_btn').addEventListener('click', function(e){
    e.stopPropagation();
    var p = gid('info_panel'), open = !p.classList.contains('open');
    p.classList.toggle('open', open); this.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.addEventListener('click', function(e){
    var p = gid('info_panel');
    if (p.classList.contains('open') && !p.contains(e.target)){ p.classList.remove('open'); gid('info_btn').setAttribute('aria-expanded', 'false'); }
  });
  gid('game-submit').addEventListener('click', function(){ if (revealed) advance(); else submit(); });
  gid('game-play').addEventListener('click', showBlockStart);
  gid('game-block-start').addEventListener('click', showRound);
  gid('game-keepplaying').addEventListener('click', showIntro);
  gid('game-exit').addEventListener('click', closeOverlay);
  document.querySelectorAll('#sec-game .card-x').forEach(function(b){ b.addEventListener('click', closeOverlay); });

  // Keyboard, only while the overlay is open: Esc leaves (or closes the "?" panel
  // first); Enter starts from the intro / block screens. Capture phase +
  // stopImmediatePropagation keeps the page's Enter→Go handler from firing.
  document.addEventListener('keydown', function(e){
    if (gid('game-overlay').hidden) return;
    if (e.key === 'Escape'){
      e.preventDefault(); e.stopImmediatePropagation();
      var p = gid('info_panel');
      if (p.classList.contains('open')){ p.classList.remove('open'); gid('info_btn').setAttribute('aria-expanded', 'false'); return; }
      closeOverlay(); return;
    }
    if (e.key === 'Enter' && !e.isComposing){
      if (!gid('game-intro').hidden){ e.preventDefault(); e.stopImmediatePropagation(); showBlockStart(); }
      else if (!gid('game-block').hidden){ e.preventDefault(); e.stopImmediatePropagation(); showRound(); }
      else { e.stopImmediatePropagation(); }
    }
  }, true);
})();
