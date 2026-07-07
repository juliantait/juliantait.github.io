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
   Reuses the page's existing generators and posterior math:
     linspaceArr, makeNormal, olsBetaHat, ssOfX, posteriorOverCandidates, fmtSigned.
   Candidate slopes and prior are fixed per the study; σ and the EXPERT/NOVICE
   sample sizes are read live from the Simulation controls (so the Game stays in
   sync with the rest of the page), with the page defaults as fallback.
   ============================================================================ */
(function(){
  'use strict';

  var BETAS  = [-0.2, 0, 0.2];        // candidate true slopes
  var PRIORS = [0.25, 0.5, 0.25];     // heavy-middle prior: P(0)=½, ¼ on each extreme
  var MAXBELIEF = 100;                // belief bars are 0–100, independent (never auto-adjusted)

  // ---- mutable round + control state ----
  var round = null;          // { sigma, n, isExpert, trueIdx, trueBeta, x, y, betaHat, se, posterior }
  var revealed = false;      // false on the bet screen, true on the results screen
  var beliefs = [25, 50, 25]; // belief-bar heights (independent; init at prior)
  var h1 = 0.25, h2 = 0.75;   // allocation handles default to the prior split: €0.25 / €0.50 / €0.25
  var betaGuess = 0;          // vertical slider value in [-0.5, +0.5]

  // ---- in-memory session accumulators (reset on page reload) ----
  var sess = { rounds: 0, won: 0, betHits: 0 };
  var scoredThisRound = false;  // guard so each revealed round is counted once

  function gid(id){ return document.getElementById(id); }
  function eur(x){ return '€' + x.toFixed(2); }
  function signed(v){ return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2); }

  function readParam(id, fallback){
    var el = gid(id);
    var v = el ? parseFloat(el.value) : NaN;
    return (isFinite(v) && v > 0) ? v : fallback;
  }

  // ---- generate one fresh round ----
  function genRound(){
    var sigma = readParam('sigma', 1.5);
    var nNov  = Math.round(readParam('nNov', 4));
    var nExp  = Math.round(readParam('nExp', 80));

    var isExpert = Math.random() < 0.5;        // P(expert) = P(novice) = ½
    var n = isExpert ? nExp : nNov;

    // draw the true state from the prior  P(0)=½, P(−0.2)=¼, P(+0.2)=¼
    var u = Math.random(), trueIdx;
    if (u < 0.5) trueIdx = 1; else if (u < 0.75) trueIdx = 0; else trueIdx = 2;
    var trueBeta = BETAS[trueIdx];

    // fixed design x = linspace(0,10,n) (the page's default fixed-x mode);
    // y = β·x + N(0, σ²) using the page's Box–Muller generator.
    var x = linspaceArr(0, 10, n);
    var norm = makeNormal(Math.random);
    var y = new Array(n);
    for (var i = 0; i < n; i++) y[i] = trueBeta * x[i] + sigma * norm();

    var betaHat = olsBetaHat(x, y);
    var se = sigma / Math.sqrt(ssOfX(x));
    // optimal allocation = posterior P(state | data), exactly the page's closed form.
    // Renormalise defensively so the optimal bet ALWAYS sums to exactly 1 (€1.00).
    var posterior = posteriorOverCandidates(betaHat, se, BETAS, PRIORS);
    var pz = posterior[0] + posterior[1] + posterior[2];
    posterior = posterior.map(function(v){ return v / pz; });

    return { sigma:sigma, n:n, isExpert:isExpert, trueIdx:trueIdx, trueBeta:trueBeta,
             x:x, y:y, betaHat:betaHat, se:se, posterior:posterior };
  }

  // ---- renderers ----
  function renderBeliefBars(){
    var bars = document.querySelectorAll('#belief-bars .bbar');
    for (var k = 0; k < bars.length; k++){
      var i = +bars[k].dataset.i;
      bars[k].querySelector('.bbar-fill').style.height = (beliefs[i] / MAXBELIEF * 100) + '%';
      bars[k].querySelector('.bbar-val').textContent = Math.round(beliefs[i]);
    }
  }

  function renderAlloc(){
    var p1 = h1 * 100, p2 = h2 * 100;
    var s = [h1, h2 - h1, 1 - h2];
    var segs = [gid('seg-a'), gid('seg-b'), gid('seg-c')];
    segs[0].style.left = '0%';  segs[0].style.width = p1 + '%';
    segs[1].style.left = p1 + '%'; segs[1].style.width = (p2 - p1) + '%';
    segs[2].style.left = p2 + '%'; segs[2].style.width = (100 - p2) + '%';
    for (var i = 0; i < 3; i++) segs[i].textContent = (s[i] >= 0.06) ? eur(s[i]) : '';
    gid('ah1').style.left = p1 + '%';
    gid('ah2').style.left = p2 + '%';
  }

  function renderBeta(){
    var frac = (0.5 - betaGuess) / 1.0;   // 0 at top (+0.5), 1 at bottom (−0.5)
    gid('beta-thumb').style.top = (frac * 100) + '%';
    gid('beta-val').textContent = signed(betaGuess);
  }

  function drawGameScatter(){
    var c = gid('game-scatter');
    if (!c || !round) return;
    var dpr = window.devicePixelRatio || 1;
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
    var xLo = -0.5, xHi = 10.5;
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
    for (var xv = 0; xv <= 10; xv += 2){
      var pxv = tx(xv);
      ctx.strokeStyle = '#eef2f7'; ctx.beginPath(); ctx.moveTo(pxv, pad.top); ctx.lineTo(pxv, pad.top + ph); ctx.stroke();
      ctx.fillStyle = '#94a3b8'; ctx.fillText(String(xv), pxv, pad.top + ph + 6);
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
    ctx.fillText('x', pad.left + pw / 2, h - 4);
    ctx.save(); ctx.translate(11, pad.top + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText('y', 0, 0); ctx.restore();

    // RESULTS overlays: realised true β (top-right) + β̂ on the OLS line (top-left),
    // both with a white halo so they stay legible over the cloud.
    if (revealed){
      var fmtB = function(b){ return b === 0 ? 'β = 0' : 'β = ' + (b > 0 ? '+' : '−') + Math.abs(b); };
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

  function setupAllocDrag(){
    var bar = gid('alloc-bar');
    function makeMove(which){
      return function(e){
        var rct = bar.getBoundingClientRect();
        var p = (e.clientX - rct.left) / rct.width;
        p = Math.max(0, Math.min(1, p));
        // Handles PUSH each other: drag one into the other and keep going and the
        // second is shoved along, so you can sweep both to either end in one drag.
        if (which === 1){ h1 = p; if (h2 < h1) h2 = h1; }
        else            { h2 = p; if (h1 > h2) h1 = h2; }
        renderAlloc();
      };
    }
    var hdl1 = gid('ah1'), hdl2 = gid('ah2');
    hdl1.addEventListener('pointerdown', startDrag(hdl1, makeMove(1)));
    hdl2.addEventListener('pointerdown', startDrag(hdl2, makeMove(2)));
  }

  function setupBetaDrag(){
    var track = gid('beta-track');
    track.addEventListener('pointerdown', startDrag(track, function(e){
      var rct = track.getBoundingClientRect();
      var frac = (e.clientY - rct.top) / rct.height;
      frac = Math.max(0, Math.min(1, frac));
      betaGuess = Math.round((0.5 - frac) * 100) / 100;
      renderBeta();
    }));
  }

  // ---- scoring: paired-uniform (binarized quadratic) scoring rule ----
  // Stakes a = (a₋, a₀, a₊) sum to 1; e is the indicator of the realised state.
  // Quadratic loss ℓ = Σ(aₖ − eₖ)² ∈ [0,2]; win-probability w = 1 − ℓ/2 ∈ [0,1].
  // A single Uniform(0,1) draw U binarizes it: pay €1 iff U < w, else €0. Expected
  // payoff = w euros, maximised (truthfully) at a = posterior — a strictly proper rule.
  function winProbOf(alloc, eIdx){
    var loss = 0;
    for (var k = 0; k < 3; k++){
      var e = (k === eIdx) ? 1 : 0;
      loss += (alloc[k] - e) * (alloc[k] - e);
    }
    return 1 - loss / 2;
  }

  // largest-remainder (Hamilton) rounding → three integer % summing to EXACTLY 100
  function pcts(probs){
    var raw = probs.map(function(p){ return p * 100; });
    var fl = raw.map(Math.floor);
    var rem = Math.round(100 - (fl[0] + fl[1] + fl[2]));
    var order = raw.map(function(v, i){ return { i:i, f:v - fl[i] }; })
                   .sort(function(a, b){ return b.f - a.f; });
    for (var j = 0; j < rem; j++){ fl[order[j % 3].i]++; }
    return fl;
  }

  // ---- reveal overlays, drawn in place on the results screen ----
  function renderBeliefOverlay(){
    // Re-standardise the player's beliefs to sum to 100 — SAME ratios they
    // submitted, just rescaled — so they share the optimal posterior's scale;
    // then overlay that posterior (orange line) on each bar.
    var sum = beliefs[0] + beliefs[1] + beliefs[2];
    var frac = (sum > 0) ? beliefs.map(function(b){ return b / sum; }) : [1/3, 1/3, 1/3];
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
  function renderAllocOptimal(){
    var p = round.posterior;                    // sums to 1 → fills the optimal bar
    var segs = [gid('oseg-a'), gid('oseg-b'), gid('oseg-c')];
    var w = [p[0] * 100, p[1] * 100, p[2] * 100];
    segs[0].style.left = '0%';              segs[0].style.width = w[0] + '%';
    segs[1].style.left = w[0] + '%';        segs[1].style.width = w[1] + '%';
    segs[2].style.left = (w[0] + w[1]) + '%'; segs[2].style.width = w[2] + '%';
    for (var i = 0; i < 3; i++) segs[i].textContent = (p[i] >= 0.07) ? eur(p[i]) : '';
  }
  function renderBetaHat(){
    var bh = Math.max(-0.5, Math.min(0.5, round.betaHat));   // clamp marker onto the track
    gid('beta-hat').style.top = ((0.5 - bh) * 100) + '%';
    gid('beta-hat').querySelector('span').textContent = signed(round.betaHat);
    gid('beta-hat-val').textContent = 'β̂ ' + signed(round.betaHat) + ' (you off ' + Math.abs(betaGuess - round.betaHat).toFixed(2) + ')';
  }

  // ---- Submit → results screen: same layout, truth revealed in place ----
  function submit(){
    if (revealed || !round) return;
    revealed = true;
    gid('sec-game').classList.add('revealed');

    var alloc = [h1, h2 - h1, 1 - h2];
    var t = round.trueIdx;
    var p = round.posterior;

    // realised paired-uniform payout (scored against the state that occurred)
    var winChance = winProbOf(alloc, t);
    var payout = (Math.random() < winChance) ? 1 : 0;

    // ex-ante expected score under the posterior — maximised by betting a = p
    var expScore = function(a){ var s = 0; for (var k = 0; k < 3; k++) s += p[k] * winProbOf(a, k); return s; };
    var wYou = expScore(alloc), wOpt = expScore(p);

    renderBeliefOverlay();   // your beliefs (rescaled) + optimal posterior overlay (bottom-left)
    renderAllocOptimal();    // the "optimal" bet bar under your bet (bottom-right)
    renderBetaHat();         // β̂ marker on the slider (right of the scatter)
    drawGameScatter();       // β̂ + your-slope lines on the scatter (top-left)

    gid('bet-earn').innerHTML =
      '<div class="earn-stat paid"><span class="v">' + eur(payout) + '</span><span class="k">paid this round</span></div>' +
      '<div class="earn-stat"><span class="v">' + eur(wYou) + '</span><span class="k">your bet · expected</span></div>' +
      '<div class="earn-stat opt"><span class="v">' + eur(wOpt) + '</span><span class="k">optimal · expected</span></div>';

    // ---- accumulate this round into the session (once) ----
    if (!scoredThisRound){
      scoredThisRound = true;
      var betTopIdx = alloc.indexOf(Math.max(alloc[0], alloc[1], alloc[2]));   // largest euro stake
      sess.rounds  += 1;
      sess.won     += payout;
      sess.betHits += (betTopIdx === t) ? 1 : 0;
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
    beliefs = [25, 50, 25];
    h1 = 0.25; h2 = 0.75;   // prior split €0.25 / €0.50 / €0.25 (matches the belief-bar default)
    betaGuess = 0;

    var rl = gid('game-role');
    rl.textContent = (round.isExpert ? 'EXPERT' : 'NOVICE') + ' · n=' + round.n;
    rl.className = 'game-role ' + (round.isExpert ? 'expert' : 'novice');

    gid('game-submit').textContent = 'Submit';   // reset the in-place button label
    renderBeliefBars(); renderAlloc(); renderBeta(); drawGameScatter();
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
  // honour a deep link straight into the game (e.g. /projects/experts/#game)
  if (location.hash === '#game') openOverlay();
  // read-only snapshot for E2E tests (in-memory only; no behaviour/persistence change)
  window.__gameState = function(){
    return {
      round: round ? { trueIdx: round.trueIdx, trueBeta: round.trueBeta, isExpert: round.isExpert, n: round.n } : null,
      betaGuess: betaGuess, alloc: [h1, h2 - h1, 1 - h2], revealed: revealed,
      sess: { rounds: sess.rounds, won: sess.won, betHits: sess.betHits }
    };
  };

  // ---- init ----
  setupBeliefDrag();
  setupAllocDrag();
  setupBetaDrag();
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
