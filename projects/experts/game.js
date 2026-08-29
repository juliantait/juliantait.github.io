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
   GAME — single-player betting / prediction task.
   Reuses the page's existing generators, constants and posterior math:
     X_SPAN, BASELINE_LO/HI, observe, analysisSigma, linspaceArr, makeNormal,
     olsBetaHat, ssOfX, posteriorOverCandidates, readPriors, candCount, fmtSigned.
   The candidate slopes, their prior, σ and the EXPERT/NOVICE sample sizes are all
   read LIVE from the Simulation controls, so the Game always runs the design the
   panel shows (2 states, prior 0.75 / 0.25, β₂ = 0.03 by default), with these
   fallbacks if the panel is unreadable. The belief bars, the €1 allocation bar
   and its handles are therefore built per round, one slot per candidate.
   ============================================================================ */
(function(){
  'use strict';

  var FALLBACK_BETAS  = [0, 0.03];
  var FALLBACK_PRIORS = [0.75, 0.25];
  var MAXBELIEF = 100;                // belief bars are 0–100, independent (never auto-adjusted)
  // β-guess slider range. β is a per-year slope now, so ±0.06 covers the 0.01–0.04
  // growth arms plus a NOVICE SE either side; the axis labels are drawn from these.
  var BETA_LO = -0.06, BETA_HI = 0.06, BETA_STEP = 0.001;

  // ---- mutable round + control state ----
  var round = null;          // { sigma, n, isExpert, states, trueIdx, trueBeta, baseline, x, y, betaHat, se, posterior }
  var revealed = false;      // false on the bet screen, true on the results screen
  var beliefs = [];          // belief-bar heights (independent; init at the prior)
  var betaGuess = 0;         // vertical slider value in [BETA_LO, BETA_HI]

  // ---- TWO-STEP BET (mirrors the live elicitation) ----
  // The recorded bet is POINTS ON GROWING, 0–100 (unchanged in meaning). It is
  // set in two steps: a Stable/Growing direction, then a slider clamped to the
  // chosen half. Both start UNSET each round — there is no pre-filled value, so
  // an untouched submission records nothing (Submit nudges instead).
  var BLOCK = 50;            // the physical centre / block point; 50 on both halves
  var betDir = null;         // null | 'STABLE' | 'GROWING'
  var betPts = null;         // null | integer 0–100 (points on Growing)
  var bet2ToastT = null;

  // ---- in-memory session accumulators (reset on page reload) ----
  var sess = { rounds: 0, won: 0, betHits: 0 };
  var scoredThisRound = false;  // guard so each revealed round is counted once

  function gid(id){ return document.getElementById(id); }
  function eur(x){ return '€' + x.toFixed(2); }
  // β is a per-year slope on a 0.01–0.04 scale — use the page's shared formatter
  // (3 decimals) so the Game and the Simulation print the same numbers.
  function signed(v){ return fmtSigned(v); }

  function readParam(id, fallback){
    var el = gid(id);
    var v = el ? parseFloat(el.value) : NaN;
    return (isFinite(v) && v > 0) ? v : fallback;
  }

  // ---- candidate slopes + prior, live from the Simulation controls ----
  function readStates(){
    var k = (typeof candCount === 'number') ? candCount : 2;
    var ids = (k === 3) ? ['b1','b2','b3'] : ['b1','b2'];
    var betas = ids.map(function(id){ var el = gid(id); return el ? parseFloat(el.value) : NaN; });
    var priors = readPriors(k);
    var ok = betas.every(function(v){ return isFinite(v); })
          && new Set(betas).size === betas.length
          && priors.every(function(p){ return isFinite(p) && p >= 0; });
    if (!ok){ betas = FALLBACK_BETAS.slice(); priors = FALLBACK_PRIORS.slice(); }
    // sort ascending so bars / bet segments read left→right like the rest of the page
    var order = betas.map(function(b, i){ return i; })
                     .sort(function(a, b){ return betas[a] - betas[b]; });
    return { betas: order.map(function(i){ return betas[i]; }),
             priors: order.map(function(i){ return priors[i]; }) };
  }

  // Colour slot for a candidate: with 3 states keep the page's −/0/+ colouring,
  // otherwise colour by sign (red down, grey flat, blue up).
  function segClass(b, i, K){
    if (K === 3) return 's' + i;
    return b < 0 ? 's0' : (b > 0 ? 's2' : 's1');
  }

  // ---- generate one fresh round ----
  function genRound(){
    var sigma = readParam('sigma', 2.5);
    var nNov  = Math.round(readParam('nNov', 3));
    var nExp  = Math.round(readParam('nExp', 30));
    var states = readStates();

    var isExpert = Math.random() < 0.5;        // P(expert) = P(novice) = ½
    var n = isExpert ? nExp : nNov;

    // draw the true state from the prior (0.75 flat / 0.25 growing by default)
    var u = Math.random(), acc = 0, trueIdx = states.betas.length - 1;
    for (var k = 0; k < states.betas.length; k++){
      acc += states.priors[k];
      if (u < acc){ trueIdx = k; break; }
    }
    var trueBeta = states.betas[trueIdx];

    // fixed design x = linspace(0, 100, n): n evenly spaced observation years
    // across the window (the page's default fixed-x mode). y = baseline + β·x +
    // N(0, σ²) using the page's Box–Muller generator, with an integer baseline so
    // the dots sit at realistic heights — and rounded to whole numbers at this
    // simulation step whenever the page's y-values toggle is on integers.
    var baseline = BASELINE_LO + Math.floor(Math.random() * (BASELINE_HI - BASELINE_LO + 1));
    var x = linspaceArr(0, X_SPAN, n);
    var norm = makeNormal(Math.random);
    var y = new Array(n);
    for (var i = 0; i < n; i++) y[i] = observe(baseline + trueBeta * x[i] + sigma * norm());

    // β̂ and everything derived from it therefore come from the REALISED dots.
    var betaHat = olsBetaHat(x, y);
    var se = analysisSigma(sigma) / Math.sqrt(ssOfX(x));
    // optimal allocation = posterior P(state | data), exactly the page's closed form.
    // Renormalise defensively so the optimal bet ALWAYS sums to exactly 1 (€1.00).
    var posterior = posteriorOverCandidates(betaHat, se, states.betas, states.priors);
    var pz = posterior.reduce(function(a, b){ return a + b; }, 0);
    posterior = posterior.map(function(v){ return v / pz; });

    return { sigma:sigma, n:n, isExpert:isExpert, states:states, trueIdx:trueIdx,
             trueBeta:trueBeta, baseline:baseline, x:x, y:y, betaHat:betaHat, se:se,
             posterior:posterior };
  }

  // ---- renderers ----
  // STABLE is the lowest-β candidate (flat / least-growing, index 0 after the
  // ascending sort); GROWING is everything above it. In the pilot's two-state
  // world these are exactly {flat, +β}. The posterior mass on the growing side is
  // 1 − P(stable), so the bet's "optimal points on Growing" is 100·pGrowing().
  function pGrowing(){ return 1 - round.posterior[0]; }

  // Build the per-round belief bars (one per candidate slope). The bet widget
  // itself is static markup, reset — not rebuilt — each round by bet2Reset().
  function buildBetUI(){
    var b = round.states.betas, K = b.length, i;
    var bars = '';
    for (i = 0; i < K; i++){
      var cls = segClass(b[i], i, K);
      bars += '<div class="bbar" data-i="' + i + '">' +
                '<div class="bbar-val"></div>' +
                '<div class="bbar-track"><div class="bbar-fill ' + cls + '"></div>' +
                  '<div class="bbar-opt"><span></span></div></div>' +
                '<div class="bbar-lab">' + fmtSigned(b[i]) + '</div>' +
              '</div>';
    }
    gid('belief-bars').innerHTML = bars;
    setupBeliefDrag();
    bet2Reset();
  }

  // ---- two-step bet: helpers --------------------------------------------------
  function bet2Toast(msg){
    var t = gid('bet2-toast');
    t.innerHTML = msg; t.hidden = false;
    clearTimeout(bet2ToastT);
    bet2ToastT = setTimeout(function(){ t.hidden = true; }, 2600);
  }
  function bet2Readout(){
    gid('bet2-pts-growing').textContent = (betPts == null) ? '—' : betPts;
    gid('bet2-pts-stable').textContent  = (betPts == null) ? '—' : (100 - betPts);
  }
  // Reset to the fully-unset first-view state: no direction, no bet, slider parked
  // at the block point with a hidden thumb, both readouts em-dashes, gate greyed
  // and the shield armed so a slider-first touch gets the nudge.
  function bet2Reset(){
    betDir = null; betPts = null;
    var radios = document.querySelectorAll('#bet2-seg input');
    for (var k = 0; k < radios.length; k++) radios[k].checked = false;
    var s = gid('bet2-slider');
    s.value = BLOCK; s.classList.add('is-unset');
    gid('bet2-step2-text').textContent = 'How confident are you?';
    gid('bet2-track-bg').className = 'bet2-track-bg dir-none';
    gid('bet2-gate').classList.add('locked');
    gid('bet2-shield').hidden = false;
    gid('bet2-toast').hidden = true;
    bet2Readout();
  }
  // Choosing a direction opens the gate and clamps the slider to that half. It
  // CLEARS any prior bet (never mirrors the old value across the centre), exactly
  // as the live widget does.
  function bet2SetDirection(dir){
    if (revealed) return;
    betDir = dir; betPts = null;
    var s = gid('bet2-slider');
    s.value = BLOCK; s.classList.add('is-unset');
    gid('bet2-step2-text').textContent =
      'How confident are you that it is ' + (dir === 'GROWING' ? 'growing' : 'stable') + '?';
    gid('bet2-track-bg').className =
      'bet2-track-bg ' + (dir === 'GROWING' ? 'dir-growing' : 'dir-stable');
    gid('bet2-gate').classList.remove('locked');
    gid('bet2-shield').hidden = true;
    bet2Readout();
  }
  // The slider moved: clamp to the chosen half (block reachable from both) and
  // record it. Any move reveals the thumb and sets the bet.
  function bet2OnInput(){
    if (revealed || !betDir) return;
    var v = parseInt(gid('bet2-slider').value, 10);
    if (betDir === 'GROWING') v = Math.max(BLOCK, v);
    else                      v = Math.min(BLOCK, v);
    betPts = v;
    var s = gid('bet2-slider');
    s.value = v; s.classList.remove('is-unset');
    bet2Readout();
  }
  // On reveal: an orange marker at the optimal points-on-Growing (100·pGrowing),
  // positioned to match the thumb-centre travel (track inset 10px each side).
  function bet2RenderOptimal(){
    var opt = Math.round(100 * pGrowing());
    var m = gid('bet2-opt');
    m.style.left = 'calc(10px + ' + (opt / 100) + ' * (100% - 20px))';
    m.querySelector('span').textContent = opt + ' opt';
  }

  function renderBeliefBars(){
    var bars = document.querySelectorAll('#belief-bars .bbar');
    for (var k = 0; k < bars.length; k++){
      var i = +bars[k].dataset.i;
      bars[k].querySelector('.bbar-fill').style.height = (beliefs[i] / MAXBELIEF * 100) + '%';
      bars[k].querySelector('.bbar-val').textContent = Math.round(beliefs[i]);
    }
  }

  function renderBeta(){
    var span = BETA_HI - BETA_LO;
    var frac = (BETA_HI - betaGuess) / span;   // 0 at top (BETA_HI), 1 at bottom
    gid('beta-thumb').style.top = (frac * 100) + '%';
    gid('beta-val').textContent = signed(betaGuess);
  }

  function drawGameScatter(){
    var c = gid('game-scatter');
    if (!c || !round) return;
    // cap the backing-store scale at 2: dpr 3 triples the buffer's pixel count
    // squared, and WebKit reclaims discarded canvas memory lazily
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Layout size is owned by CSS (width:100% + fixed height); here we ONLY (re)size
    // the drawing buffer. We must NOT write c.style.width/height: writing the measured
    // clientWidth back onto the canvas (with the 1px border under border-box) made the
    // border-box shrink ~2px on every redraw, so it ratcheted down each Submit/Next.
    var w = c.clientWidth || (c.parentElement ? c.parentElement.clientWidth : 0) || 560;
    var h = c.clientHeight || 200;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    var ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var pad = { top:16, right:14, bottom:28, left:44 };
    var pw = w - pad.left - pad.right, ph = h - pad.top - pad.bottom;
    var x = round.x, y = round.y;
    // one 100-year observation window; ticks are abstract year labels, not dates
    var xLo = -0.03 * X_SPAN, xHi = 1.03 * X_SPAN;
    var ymin = Math.min.apply(null, y), ymax = Math.max.apply(null, y);
    var span = Math.max(ymax - ymin, 1);
    ymin -= 0.12 * span; ymax += 0.12 * span;
    var tx = function(v){ return pad.left + (v - xLo) / (xHi - xLo) * pw; };
    var ty = function(v){ return pad.top + (1 - (v - ymin) / (ymax - ymin)) * ph; };
    var font = getComputedStyle(document.body).fontFamily;
    var niceStep = function(raw){ var e = Math.pow(10, Math.floor(Math.log10(raw))); var b = raw / e; var n = b < 1.5 ? 1 : b < 3 ? 2 : b < 7 ? 5 : 10; return n * e; };

    // gridlines + NUMERIC tick labels on both axes
    ctx.font = '9.5px ' + font; ctx.lineWidth = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    var xTick = X_SPAN / 5;
    for (var xv = 0; xv <= X_SPAN + 1e-9; xv += xTick){
      var pxv = tx(xv);
      ctx.strokeStyle = '#eef2f7'; ctx.beginPath(); ctx.moveTo(pxv, pad.top); ctx.lineTo(pxv, pad.top + ph); ctx.stroke();
      ctx.fillStyle = '#94a3b8'; ctx.fillText(String(Math.round(xv)), pxv, pad.top + ph + 6);
    }
    var yStep = niceStep((ymax - ymin) / 4);
    var yDec = yStep < 1 ? 1 : 0;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var yv = Math.ceil(ymin / yStep) * yStep; yv <= ymax; yv += yStep){
      var pyv = ty(yv);
      ctx.strokeStyle = '#eef2f7'; ctx.beginPath(); ctx.moveTo(pad.left, pyv); ctx.lineTo(pad.left + pw, pyv); ctx.stroke();
      ctx.fillStyle = '#94a3b8'; ctx.fillText(yv.toFixed(yDec), pad.left - 5, pyv);
    }
    ctx.textBaseline = 'alphabetic';

    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1;
    ctx.strokeRect(pad.left, pad.top, pw, ph);
    if (ymin <= 0 && 0 <= ymax){
      ctx.strokeStyle = '#cbd5e1'; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(pad.left, ty(0)); ctx.lineTo(pad.left + pw, ty(0)); ctx.stroke();
      ctx.setLineDash([]);
    }

    // RESULTS screen: overlay the OLS fit β̂ (green) and the player's guessed
    // slope (dashed dark), both through the data centroid, so they compare.
    if (revealed){
      var nn = x.length, xbar = 0, ybar = 0, k;
      for (k = 0; k < nn; k++){ xbar += x[k]; ybar += y[k]; }
      xbar /= nn; ybar /= nn;
      ctx.save();
      ctx.beginPath(); ctx.rect(pad.left, pad.top, pw, ph); ctx.clip();
      var line = function(slope, color, dash){
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash(dash ? [6, 4] : []);
        ctx.beginPath();
        ctx.moveTo(tx(xLo), ty(ybar + slope * (xLo - xbar)));
        ctx.lineTo(tx(xHi), ty(ybar + slope * (xHi - xbar)));
        ctx.stroke();
      };
      line(betaGuess, '#1e293b', true);       // your guess (dashed)
      line(round.betaHat, '#0e7d54', false);  // β̂ OLS (green)
      ctx.setLineDash([]);
      ctx.restore();
    }

    ctx.fillStyle = round.isExpert ? 'rgba(37,99,235,0.72)' : 'rgba(220,38,38,0.72)';
    var r = x.length > 20 ? 2.8 : 5;
    for (var i = 0; i < x.length; i++){
      ctx.beginPath(); ctx.arc(tx(x[i]), ty(y[i]), r, 0, Math.PI * 2); ctx.fill();
    }

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px ' + font;
    ctx.textAlign = 'center';
    ctx.fillText('year in window', pad.left + pw / 2, h - 4);
    ctx.save(); ctx.translate(11, pad.top + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText('y', 0, 0); ctx.restore();

    // RESULTS overlays: realised true β (top-right) + β̂ on the OLS line (top-left),
    // both with a white halo so they stay legible over the cloud.
    if (revealed){
      var fmtB = function(b){ return 'β = ' + signed(b); };
      ctx.save(); ctx.shadowColor = '#fff'; ctx.shadowBlur = 4;
      ctx.textAlign = 'left'; ctx.font = 'bold 11px ' + font;
      ctx.fillStyle = '#0e7d54'; ctx.fillText('β̂ = ' + signed(round.betaHat) + '  (OLS fit)', pad.left + 6, pad.top + 13);
      ctx.fillStyle = '#1e293b'; ctx.fillText('your slope (dashed)', pad.left + 6, pad.top + 28);
      ctx.textAlign = 'right'; ctx.font = 'bold 12px ' + font; ctx.fillStyle = '#111827';
      ctx.fillText('realised  ' + fmtB(round.trueBeta), pad.left + pw - 6, pad.top + 13);
      ctx.restore();
    }
  }
  window.__gameRedraw = drawGameScatter;

  // ---- drag wiring (pointer events → mouse + touch) ----
  function startDrag(captureEl, onMove){
    return function(e){
      if (revealed) return;
      e.preventDefault();
      try { captureEl.setPointerCapture(e.pointerId); } catch (err) {}
      onMove(e);
      var mv = function(ev){ onMove(ev); };
      var up = function(){
        captureEl.removeEventListener('pointermove', mv);
        captureEl.removeEventListener('pointerup', up);
        captureEl.removeEventListener('pointercancel', up);
      };
      captureEl.addEventListener('pointermove', mv);
      captureEl.addEventListener('pointerup', up);
      captureEl.addEventListener('pointercancel', up);
    };
  }

  function setupBeliefDrag(){
    var bars = document.querySelectorAll('#belief-bars .bbar');
    for (var k = 0; k < bars.length; k++){
      (function(bar){
        var track = bar.querySelector('.bbar-track');
        var i = +bar.dataset.i;
        track.addEventListener('pointerdown', startDrag(track, function(e){
          var rct = track.getBoundingClientRect();
          var v = (1 - (e.clientY - rct.top) / rct.height) * MAXBELIEF;
          beliefs[i] = Math.max(0, Math.min(MAXBELIEF, v));
          renderBeliefBars();
        }));
      })(bars[k]);
    }
  }

  function setupBetaDrag(){
    var track = gid('beta-track');
    var span = BETA_HI - BETA_LO;
    track.addEventListener('pointerdown', startDrag(track, function(e){
      var rct = track.getBoundingClientRect();
      var frac = (e.clientY - rct.top) / rct.height;
      frac = Math.max(0, Math.min(1, frac));
      betaGuess = Math.round((BETA_HI - frac * span) / BETA_STEP) * BETA_STEP;
      renderBeta();
    }));
  }

  // ---- scoring: binarised quadratic (paired-uniform) on the TWO-STEP bet ----
  // With m = (points on the ACTUAL type)/100, the win probability is 1 − (1−m)²
  // (main/scoring.py's binarised_win_prob, and the widget's info panel). One
  // Uniform(0,1) draw binarises it: pay €1 iff U < w, else €0. Expected payoff = w,
  // maximised truthfully at bet = 100·P(Growing) — a strictly proper rule. For the
  // two-state pilot this is identical to the old K=2 quadratic-loss rule.
  function winProbFor(bet, trueGrow){
    var m = (trueGrow ? bet : (100 - bet)) / 100;   // share on the type that occurred
    return 1 - (1 - m) * (1 - m);
  }
  // Expected win probability of a bet under the posterior (P(Growing) = pGrowing()).
  function expWinFor(bet){
    var pg = pGrowing();
    return pg * winProbFor(bet, true) + (1 - pg) * winProbFor(bet, false);
  }

  // largest-remainder (Hamilton) rounding → integer % summing to EXACTLY 100
  function pcts(probs){
    var raw = probs.map(function(p){ return p * 100; });
    var fl = raw.map(Math.floor);
    var rem = Math.round(100 - fl.reduce(function(a, b){ return a + b; }, 0));
    var order = raw.map(function(v, i){ return { i:i, f:v - fl[i] }; })
                   .sort(function(a, b){ return b.f - a.f; });
    for (var j = 0; j < rem; j++){ fl[order[j % order.length].i]++; }
    return fl;
  }

  // ---- reveal overlays, drawn in place on the results screen ----
  function renderBeliefOverlay(){
    // Re-standardise the player's beliefs to sum to 100 — SAME ratios they
    // submitted, just rescaled — so they share the optimal posterior's scale;
    // then overlay that posterior (orange line) on each bar.
    var K = beliefs.length;
    var sum = beliefs.reduce(function(a, b){ return a + b; }, 0);
    var frac = (sum > 0) ? beliefs.map(function(b){ return b / sum; })
                         : beliefs.map(function(){ return 1 / K; });
    var lab = pcts(frac);                       // integer % summing to exactly 100
    var bars = document.querySelectorAll('#belief-bars .bbar');
    for (var k = 0; k < bars.length; k++){
      var i = +bars[k].dataset.i;
      bars[k].querySelector('.bbar-fill').style.height = (frac[i] * 100) + '%';
      bars[k].querySelector('.bbar-val').textContent = lab[i] + '%';
      var opt = bars[k].querySelector('.bbar-opt');
      opt.style.height = (round.posterior[i] * 100) + '%';
      opt.querySelector('span').textContent = Math.round(round.posterior[i] * 100) + '%';
    }
  }
  function renderBetaHat(){
    var bh = Math.max(BETA_LO, Math.min(BETA_HI, round.betaHat));   // clamp onto the track
    gid('beta-hat').style.top = ((BETA_HI - bh) / (BETA_HI - BETA_LO) * 100) + '%';
    gid('beta-hat').querySelector('span').textContent = signed(round.betaHat);
    gid('beta-hat-val').textContent = 'β̂ ' + signed(round.betaHat) + ' (you off ' + Math.abs(betaGuess - round.betaHat).toFixed(3) + ')';
  }

  // ---- Submit → results screen: same layout, truth revealed in place ----
  function submit(){
    if (revealed || !round) return;
    // Two-step gate: name the step that is unfinished, like the live widget.
    if (!betDir){ bet2Toast('Choose <b>Stable</b> or <b>Growing</b> first.'); return; }
    if (betPts == null){ bet2Toast('Now set your bet: move the slider.'); return; }
    revealed = true;
    gid('sec-game').classList.add('revealed');

    var trueGrow = round.trueIdx > 0;            // STABLE is the lowest-β candidate

    // realised binarised payout, scored against the side that occurred
    var winChance = winProbFor(betPts, trueGrow);
    var payout = (Math.random() < winChance) ? 1 : 0;

    // ex-ante expected score under the posterior — maximised at bet = 100·P(Growing)
    var optPts = Math.round(100 * pGrowing());
    var wYou = expWinFor(betPts), wOpt = expWinFor(optPts);

    renderBeliefOverlay();   // your beliefs (rescaled) + optimal posterior overlay (bottom-left)
    bet2RenderOptimal();     // orange optimal-points marker on the bet slider
    renderBetaHat();         // β̂ marker on the slider (right of the scatter)
    drawGameScatter();       // β̂ + your-slope lines on the scatter (top-left)

    gid('bet-earn').innerHTML =
      '<div class="earn-stat paid"><span class="v">' + eur(payout) + '</span><span class="k">paid this round</span></div>' +
      '<div class="earn-stat"><span class="v">' + eur(wYou) + '</span><span class="k">your bet · expected</span></div>' +
      '<div class="earn-stat opt"><span class="v">' + eur(wOpt) + '</span><span class="k">optimal · expected</span></div>';

    // ---- accumulate this round into the session (once) ----
    if (!scoredThisRound){
      scoredThisRound = true;
      sess.rounds  += 1;
      sess.won     += payout;
      // bet "hit" = the side you leant toward matches the realised side (50 = no call)
      var hit = (betPts > 50 && trueGrow) || (betPts < 50 && !trueGrow);
      sess.betHits += hit ? 1 : 0;
    }

    // the Submit button becomes "Next round" in place (realised slope is now on the chart)
    gid('game-submit').textContent = 'Next round →';
  }

  // ---- new round: regenerate everything and reset the controls ----
  function newRound(){
    round = genRound();
    revealed = false;
    scoredThisRound = false;
    gid('sec-game').classList.remove('revealed');
    // beliefs start at the prior (0.75 / 0.25 by default); the two-step bet starts
    // UNSET — no direction, no points — reset by buildBetUI → bet2Reset().
    beliefs = round.states.priors.map(function(p){ return p * MAXBELIEF; });
    betaGuess = 0;

    var rl = gid('game-role');
    rl.textContent = (round.isExpert ? 'EXPERT' : 'NOVICE') + ' · n=' + round.n;
    rl.className = 'game-role ' + (round.isExpert ? 'expert' : 'novice');

    gid('game-submit').textContent = 'Submit';   // reset the in-place button label
    buildBetUI();
    renderBeliefBars(); renderBeta(); drawGameScatter();
  }

  // ---- session summary screen ----
  function pctStr(hits, n){ return hits + ' of ' + n + ' (' + (n ? Math.round(hits / n * 100) : 0) + '%)'; }
  function showSummary(){
    gid('sum-won').textContent = eur(sess.won);
    gid('sum-rounds').textContent = sess.rounds;
    gid('sum-bethit').textContent = pctStr(sess.betHits, sess.rounds);
    gid('game-panel').hidden = true;
    gid('game-intro').hidden = true;
    gid('game-summary').hidden = false;
  }
  function keepPlaying(){      // leave the summary, back to a fresh bet (totals preserved)
    gid('game-summary').hidden = true;
    gid('game-intro').hidden = true;
    gid('game-panel').hidden = false;
    newRound();
  }

  // ---- overlay open / close (the Game lives over the Simulated Groups page) ----
  function showIntro(){ gid('game-intro').hidden = false; gid('game-panel').hidden = true; gid('game-summary').hidden = true; }
  function play(){
    gid('game-intro').hidden = true;
    gid('game-summary').hidden = true;
    gid('game-panel').hidden = false;
    newRound();                         // fresh realisation; the panel now has real width
  }
  function openOverlay(){
    gid('game-overlay').hidden = false;
    document.body.classList.add('game-open');
    showIntro();                        // every entry starts at the intro screen
    if (window.__gameSetActive) window.__gameSetActive('view-game');
  }
  function closeOverlay(){
    gid('game-overlay').hidden = true;
    document.body.classList.remove('game-open');
    if (window.__gameSetActive) window.__gameSetActive('view-groups');
  }
  window.__gameOpen = openOverlay;
  window.__gameClose = closeOverlay;
  // honour a deep link straight into the game (e.g. simulator.html#game),
  // both on load and when the hash changes within the page
  if (location.hash === '#game') openOverlay();
  window.addEventListener('hashchange', function(){
    if (location.hash === '#game') openOverlay();
  });
  // read-only snapshot for E2E tests (in-memory only; no behaviour/persistence change)
  window.__gameState = function(){
    return {
      round: round ? { trueIdx: round.trueIdx, trueBeta: round.trueBeta, isExpert: round.isExpert, n: round.n } : null,
      betaGuess: betaGuess, bet: { dir: betDir, pts: betPts }, revealed: revealed,
      sess: { rounds: sess.rounds, won: sess.won, betHits: sess.betHits }
    };
  };

  // ---- init ----
  // The belief bars are rebuilt (and re-wired) each round by buildBetUI; the β-guess
  // track and the two-step bet controls are permanent elements, wired once here.
  setupBetaDrag();
  // two-step bet: step 1 opens the gate + clamps step 2; the shield turns a
  // slider-first touch into the nudge instead of silence.
  document.querySelectorAll('#bet2-seg input').forEach(function(r){
    r.addEventListener('change', function(){ bet2SetDirection(r.value); });
  });
  (function(){
    var s = gid('bet2-slider');
    s.addEventListener('input', bet2OnInput);
    s.addEventListener('keydown', function(e){
      if (!betDir){ e.preventDefault(); bet2Toast('Choose <b>Stable</b> or <b>Growing</b> first.'); }
    });
    gid('bet2-shield').addEventListener('pointerdown', function(e){
      e.preventDefault(); bet2Toast('Choose <b>Stable</b> or <b>Growing</b> first.');
    });
  })();
  // β-axis labels come from the slider bounds so they cannot drift out of sync
  gid('beta-axis').innerHTML = '<span>' + signed(BETA_HI) + '</span><span>0</span><span>' + signed(BETA_LO) + '</span>';
  // one footer button: Submit on the bet screen, Next round on the results screen
  gid('game-submit').addEventListener('click', function(){ if (revealed) newRound(); else submit(); });
  gid('game-results-btn').addEventListener('click', showSummary);   // reveal screen → session summary
  gid('game-keepplaying').addEventListener('click', keepPlaying);   // summary → next bet (totals preserved)
  gid('game-exit').addEventListener('click', closeOverlay);         // summary → leave to Simulated Groups
  gid('game-play').addEventListener('click', play);
  document.querySelectorAll('#sec-game .card-x').forEach(function(b){ b.addEventListener('click', closeOverlay); });

  // Keyboard, only while the overlay is open: Esc leaves the game, Enter advances
  // the intro (= Play). Capture phase + stopImmediatePropagation keeps the
  // Simulated-Groups Enter→Go handler underneath from also firing.
  document.addEventListener('keydown', function(e){
    if (gid('game-overlay').hidden) return;
    if (e.key === 'Escape'){ e.preventDefault(); e.stopImmediatePropagation(); closeOverlay(); return; }
    if (e.key === 'Enter' && !e.isComposing){
      e.preventDefault(); e.stopImmediatePropagation();
      if (!gid('game-intro').hidden) play();
    }
  }, true);

  var gResizeT;
  window.addEventListener('resize', function(){
    clearTimeout(gResizeT);
    gResizeT = setTimeout(function(){ if (round && !gid('game-overlay').hidden) drawGameScatter(); }, 80);
  });
})();
