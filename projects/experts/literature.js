"use strict";
/* =============================================================================
   LITERATURE.JS  (Experts literature positioning page)
   -----------------------------------------------------------------------------
   1. PAPERS: one entry per close paper. `rows` lists the chain links the paper
      tests (contiguous); `cells[k]` is the label shown in link k.
   2. Matrix: CSS grid, links as rows and papers as columns; each paper is ONE
      grid item spanning its rows (subgrid keeps the labels on their rows).
      The "Transpose" toggle swaps to papers as rows, links as columns.
   3. Paper popover: hover (mouse, short delay) or tap/click to pin. Escape,
      outside click, horizontal scroll of the matrix and resize close it.
      Styled with the shared .ic-card look from infocard.css.
   4. Sticky topbar collapse, as on simulator.html.
   ============================================================================= */

var LINKS = [
  { n: 1, name: 'Information → confidence' },
  { n: 2, name: 'Confidence → sharing' },
  { n: 3, name: 'Sharing → receiver learning' }
];

/* Column order: link-1-only papers, then the sharing papers, then OURS. */
var PAPERS = [
  { id: 'gt', short: 'Griffin & Tversky', cite: 'Griffin and Tversky (1992), Cognitive Psychology',
    group: 'one', rows: [1], cells: { 1: 'strength over weight' },
    did: 'Coin-spin samples that vary the proportion of heads (strength) and the sample size (weight), within person, n = 35 in Study 1.',
    measures: 'Stated confidence 50 to 100 that the coin is biased the favoured way. Not incentivised.',
    found: 'Strength weighs about 2.2 times weight. At the same posterior, 3 of 3 heads gets 85% confidence, 6 of 9 gets 67%.',
    notOurs: 'No incentives, no other person, numeric counts not charts.' },
  { id: 'kp', short: 'Kvam & Pleskac', cite: 'Kvam and Pleskac (2016), Cognition',
    group: 'one', rows: [1], cells: { 1: 'visual stream, strength over weight' },
    did: 'Pink and green dots arrive one by one from a pool that is two thirds one colour. 29 students. Choice task, then a confidence task on the same dot sequence.',
    measures: 'Confidence 0 to 100 that the pool is the chosen colour, feedback each trial.',
    found: 'Confidence loads 0.37 on strength and 0.12 on weight; underconfidence at high weight and low strength. Our re-analysis of their public data: at identical composition a stream whose majority leads from the start gets 3.5 points more confidence; late-bunched majorities get less. They recorded the order and never analysed it.',
    notOurs: 'No other person, no sharing. Closest perceptual analogue of our charts.' },
  { id: 'eg', short: 'Enke & Graeber', cite: 'Enke and Graeber (2023), QJE',
    group: 'one', rows: [1], cells: { 1: 'n randomised; belief and CU' },
    did: 'Two-urn updating; 1, 3 or 5 balls, diagnosticity and base rate all randomised per trial and known; about 3,000 participants across domains.',
    measures: 'Stated posterior (binarised scoring rule) and cognitive uncertainty, "how certain are you that the optimal guess is within one point of yours".',
    found: 'Cognitive uncertainty rises with sample size at a fixed posterior; higher cognitive uncertainty compresses beliefs toward 50. Our re-analysis of their data: the stated belief does NOT move with mixed versus pure samples at the same posterior (+0.1 points, p = .92); the response to evidence falls with n in Experiment B (−0.18, p = .033).',
    notOurs: 'No other person. Their confidence is about one\'s own computation, not the state.' },
  { id: 'alt', short: 'Augenblick, Lazarus & Thaler', cite: 'Augenblick, Lazarus and Thaler (2025), QJE',
    group: 'one', rows: [1], cells: { 1: 'signal strength; demand to receive' },
    did: 'One card from a deck with a known share of diamonds, 16 signal strengths; 500 Prolific; extra rounds with three cards; a willingness to pay for cards.',
    measures: 'Stated probability of the deck, paired-uniform scoring.',
    found: 'Overinference from weak signals and underinference from strong ones (weight on the signal <code>k S^−(1−β)</code>, k = 0.88, β = 0.76); three cards count for less than one. Our re-analysis: no conflict penalty for a 2-1 split against 3-0 once their own weak-signal overweighting is controlled.',
    notOurs: 'Strength is per-signal diagnosticity, not the amount of data; the purchase result is a demand to receive, no sender.' },
  { id: 'hu', short: 'Hu', cite: 'Hu (2026), working paper, R&amp;R at Review of Economic Studies',
    group: 'one', rows: [1], cells: { 1: 'sample-size neglect; opt to learn' },
    did: 'Box A with 4 draws against Box B with 10 or 25; multiple price list on how many red balls B needs to beat A; three information structures between subject; 400 Prolific.',
    measures: 'Switching points (indifference curves over samples); confidence as a binary choice to learn the optimal switching point at a 1% risk to the bonus.',
    found: 'Indifference curves are not parallel for 95% of people; sample-size neglect in 39% of choices; neglect goes with MORE confidence (about 10 points less opting to learn).',
    notOurs: 'No sender, no roles, no other person. Confidence is a demand to learn, not a belief about the state.' },
  { id: 'cd', short: 'Ciccione & Dehaene', cite: 'Ciccione and Dehaene (2021), Cognitive Psychology',
    group: 'one', rows: [1], cells: { 1: 'trend reading tracks t' },
    did: 'Scatterplots with 6 to 66 points, noise and slope crossed; increasing or decreasing judgments, line fitting, extrapolation.',
    measures: 'Binary trend judgment, fitted line. No confidence.',
    found: 'Trend judgments are a sigmoid of the regression t-value; slopes are overestimated.',
    notOurs: 'No confidence, no incentive, no social stage. Supports the chart as a stimulus where n matters.' },

  { id: 'he', short: 'Hertz et al.', cite: 'Hertz, Tyropoulou, Traberg and Bahrami (2020), Scientific Reports',
    group: 'share', rows: [2], cells: { 2: 'pay a fee for worthless influence' },
    did: 'The adviser sees a flashed grid, advises on a 10-level scale; a computer client picks the adviser or a computer rival; the adviser can pay a fixed fee to raise the chance of being picked next trial; four experiments of about 50.',
    measures: 'Pay or not each trial (10 cents or 20 pence); the advice scale, unscored. Never paying maximises earnings.',
    found: '80% pay at least once; paying is most likely after correct advice that was ignored; when ignored, people pay more as their uncertainty falls.',
    notOurs: 'Computer client, nothing is transmitted, a fixed fee not a price, confidence unincentivised. Template for our no-consequence control.' },
  { id: 'ego', short: 'Enke, Graeber & Oprea', cite: 'Enke, Graeber and Oprea (2023), AER',
    group: 'share', rows: [2, 3], cells: { 2: 'confidence → free self-weight', 3: 'aggregate improves only if confidence tracks accuracy' },
    did: '15 cognitive tasks, everyone sees the same information; groups of 10 formed after the fact, nobody meets; one 0 to 100 slider sets how much weight your own answer gets (bets, auction bids or committee votes).',
    measures: 'The slider; confidence "how certain are you that your Part 1 decision was optimal", 0 to 100, not incentivised; the group aggregate\'s accuracy.',
    found: 'Confidence and votes correlate 0.89; optimal answers get 75 votes, suboptimal 58; self-selection improves the aggregate only in tasks where confidence tracks accuracy (their β).',
    notOurs: 'Information never varies across people; the weight is free; nothing is transmitted to anyone. Their confidence excludes information by construction.' },
  { id: 'gr', short: 'Grabova', cite: 'Grabova (2023), working paper, Humboldt and DIW Berlin',
    group: 'share', rows: [2, 3], cells: { 2: 'confidence shock → binary free forwarding', 3: 'DM accuracy; hard test silences the competent' },
    did: 'An easy or a hard Raven test to shift confidence about one\'s rank; then two senders (the better performer\'s letter is 100% accurate, the other\'s a coin flip) and a decision maker who gets exactly one letter; 474 lab participants, one shot.',
    measures: 'Belief of being the high performer (binarised scoring rule); forward or not (binary, free); the decision maker\'s stated accuracy of the advice (scoring rule).',
    found: 'The easy test raises forwarding by 33 points; one point of belief raises forwarding 1.17 points; the hard test silences the competent sender more (−47 points) than the incompetent one (−18); the efficient outcome happens 28% of the time against 83% with feedback.',
    notOurs: 'Confidence comes from an unrelated test, not from the information being shared; no price; no per-message value; one shot.' },
  { id: 'vw', short: 'Vespa & Weizsäcker', cite: 'Vespa and Weizsäcker (2026), "Do We Talk Too Much?", manuscript, April 2026',
    group: 'share', rows: [2, 3], cells: { 2: 'talk or listen; precise type talks more', 3: 'forced-opposite rounds price the error' },
    did: 'Two players, one hint each with precision τ, each chooses TALK (show my hint) or LISTEN (see yours), only one hint moves; 30 periods; from period 6 a threshold set before seeing the hint; a sixth of rounds forced TALK, a sixth forced LISTEN; 370 UCSB participants. Treatments: τ 0.6 or 0.9 for both, trivia with easy or hard wording, and an asymmetric arm.',
    measures: 'The TALK threshold; the belief after communication (binarised scoring rule, one report pays both).',
    found: 'People talk more when the task is easy (48% against 53%, context 38% against 51%); empirical cutoffs sit near the theory (0.79); being forced to do the opposite raises error, so the answer to the title is no.',
    asym: 'April 2026 manuscript, pp. 11-12, 17, App. C: τ 0.9 against 0.6 with fixed types, 80 subjects. The imprecise type talks 37.5% of the time, the precise type 55.9%, significant at 1%. Empirically optimal cutoffs: the imprecise type should listen to almost any signal, the precise type should talk from 70. Not reported: the forced-draw cost of mis-allocated talk in asymmetric pairs. Appendix C thresholds show the precise type on the Bayesian cutoff and the imprecise type far below it, so the compression is over-talking by the less informed, not under-talking by the informed (our computation).',
    notOurs: 'The cost of talking is forgone listening to an equally informed peer, not money; precision is signal quality not quantity; no confidence before talking; no price.' },
  { id: 'aa', short: 'Aarts et al.', cite: 'Aarts, Offerman, Smeets and van Leeuwen (2026), working paper, "The Demand for (Useless) Communication"',
    group: 'share', rows: [2, 3], cells: { 2: 'BDM price to persuade or be informed', 3: 'value added rises with ability-confidence fit' },
    did: 'Groups of 3, five tasks, face-to-face talk up to five minutes, everyone re-decides privately; 225 participants in Tilburg.',
    measures: 'Private answer and confidence 0 to 10 (placement, not incentivised); four BDM price lists from 0 to 8 euro (be informed and persuade, be informed, persuade, for fun); speaking time; the group median before and after.',
    found: 'People pay about 2.00 euro for talk worth 1.10; WTP to be informed 1.69 beats WTP to persuade 1.21; confidence lowers WTP to listen (−0.50 per SD) and does not move WTP to persuade (+0.10, not significant); communication adds value only where confidence tracks ability; speaking time buys influence.',
    notOurs: 'Everyone is informed, talk goes both ways, ability is a correct-or-not dummy, no Bayesian value per message.' },
  { id: 'ka', short: 'Kawamura', cite: 'Kawamura (2015), Theory and Decision',
    group: 'share', rows: [2, 3], cells: { 2: 'theory: miscalibrated sender', 3: 'theory: information loss' },
    did: 'A model of aligned cheap talk where the sender is over- or underconfident about their own competence.',
    measures: 'Nothing, theory only.',
    found: 'Miscalibration loses information even with aligned payoffs; an underconfident sender may prefer not to communicate at all.',
    notOurs: 'No experiment. It is the prediction we test.' },

  { id: 'ours', short: 'OURS', cite: 'The Experts design',
    group: 'ours', rows: [1, 2, 3],
    cells: { 1: 'n assigned (EXPERT 20, NOVICE 3); incentivised bet', 2: 'BDM price to send; Bayesian value per message', 3: 'uninformed RECEIVER acts on it; loss against Bayes' },
    design: 'One informed SENDER, EXPERT (20 dots) or NOVICE (3 dots), assigned at random, within person with order between; bets on Stable against Growing, paid by a scoring rule; states a BDM price to pass a message to a RECEIVER who has nothing; both paid by the RECEIVER\'s outcome. Message type is the second factor.' }
];

var BY_ID = {};
PAPERS.forEach(function(p){ BY_ID[p.id] = p; });

/* ---------------------------------------------------------------- matrix -- */
(function(){
  var mx = document.getElementById('mx');
  if(!mx) return;
  var html = '<div class="mx-corner">Link</div>';
  LINKS.forEach(function(l){
    html += '<div class="mx-link" data-link="' + l.n + '">' +
      '<span class="mx-link-num">' + l.n + '</span><span class="mx-link-name">' + l.name + '</span></div>';
  });
  PAPERS.forEach(function(p){
    html += '<div class="mx-head g-' + p.group + '" data-paper="' + p.id + '">' +
      '<button type="button" class="lp-name" data-paper="' + p.id + '" aria-expanded="false">' + p.short + '</button></div>';
    html += '<div class="mx-cell g-' + p.group + '" data-paper="' + p.id + '" data-rows="' + p.rows.join(',') + '">';
    p.rows.forEach(function(r){
      html += '<span class="mx-lab" data-row="' + r + '">' + p.cells[r] + '</span>';
    });
    html += '</div>';
  });
  mx.innerHTML = html;

  /* place every item; "wide" = links as rows, "tall" = links as columns.
     The cross axis of the grid is the same data, so only row/column swap. */
  function at(el, a, b){  // a = position along the paper axis, b = along the link axis
    var wide = mx.getAttribute('data-layout') === 'wide';
    el.style.gridRow = wide ? b : a;
    el.style.gridColumn = wide ? a : b;
  }
  function layout(){
    at(mx.querySelector('.mx-corner'), '1', '1');
    Array.prototype.forEach.call(mx.querySelectorAll('.mx-link'), function(el){
      at(el, '1', String(+el.getAttribute('data-link') + 1));
    });
    PAPERS.forEach(function(p, i){
      var lo = p.rows[0], n = p.rows.length, pos = String(i + 2);
      at(mx.querySelector('.mx-head[data-paper="' + p.id + '"]'), pos, '1');
      var cell = mx.querySelector('.mx-cell[data-paper="' + p.id + '"]');
      at(cell, pos, (lo + 1) + ' / span ' + n);
      Array.prototype.forEach.call(cell.querySelectorAll('.mx-lab'), function(lab){
        at(lab, '1', String(+lab.getAttribute('data-row') - lo + 1));
      });
    });
  }
  mx.style.setProperty('--np', PAPERS.length);
  layout();

  var scroller = document.getElementById('mx-scroll');
  var hint = document.getElementById('mx-hint');
  /* show the hint while the far end of the matrix (OURS) is out of view */
  function updateHint(){
    if(!hint || !scroller) return;
    hint.hidden = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4;
  }
  if(scroller){
    scroller.addEventListener('scroll', updateHint, { passive: true });
    window.addEventListener('resize', updateHint);
  }
  updateHint();
  Array.prototype.forEach.call(document.querySelectorAll('.mx-toggle button'), function(b){
    b.addEventListener('click', function(){
      var lay = b.getAttribute('data-layout');
      mx.setAttribute('data-layout', lay);
      layout();
      Array.prototype.forEach.call(document.querySelectorAll('.mx-toggle button'), function(o){
        var on = o === b;
        o.classList.toggle('on', on);
        o.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      if(scroller) scroller.scrollLeft = 0;
      updateHint();
      if(window.PaperCard) window.PaperCard.close();
    });
  });
})();

/* ------------------------------------------------------- paper popover -- */
(function(){
  var card = null, owner = null, pinned = false;
  var openTimer = 0, closeTimer = 0;
  var OPEN_DELAY = 160, CLOSE_DELAY = 140, MARGIN = 8;

  function cardHTML(p){
    var h = '<div class="ic-title">' + p.cite + '</div><div class="ic-body pc-body">';
    h += '<div class="pc-rows">' + LINKS.map(function(l){
      var on = p.rows.indexOf(l.n) >= 0;
      return '<span class="pc-chip' + (on ? ' on' : '') + '">' + l.n + ' ' + l.name + '</span>';
    }).join('') + '</div>';
    if(p.design){
      h += '<p>' + p.design + '</p>';
    } else {
      h += '<p><b>Did.</b> ' + p.did + '</p>' +
           '<p><b>Measures.</b> ' + p.measures + '</p>' +
           '<p><b>Found.</b> ' + p.found + '</p>' +
           (p.asym ? '<p><b>Asymmetric arm.</b> ' + p.asym + '</p>' : '') +
           '<p class="pc-not"><b>Not ours because.</b> ' + p.notOurs + '</p>';
    }
    return h + '</div>';
  }

  function place(){
    if(!card || !owner) return;
    var r = owner.getBoundingClientRect(), gap = 8;
    var vw = document.documentElement.clientWidth, vh = window.innerHeight;
    card.style.maxHeight = (vh - 2 * MARGIN) + 'px';
    var w = card.offsetWidth, h = card.offsetHeight;
    var left = Math.min(Math.max(r.left + r.width / 2 - w / 2, MARGIN), vw - w - MARGIN);
    var top = r.bottom + gap;
    if(top + h > vh - MARGIN){
      if(r.top - gap - h >= MARGIN) top = r.top - gap - h;
      else top = Math.max(MARGIN, vh - MARGIN - h);
    }
    card.style.left = Math.round(left) + 'px';
    card.style.top = Math.round(top) + 'px';
  }

  function close(){
    clearTimeout(openTimer); clearTimeout(closeTimer);
    if(card && card.parentNode) card.parentNode.removeChild(card);
    if(owner) owner.setAttribute('aria-expanded', 'false');
    card = null; owner = null; pinned = false;
  }

  function open(btn, pin){
    var p = BY_ID[btn.getAttribute('data-paper')];
    if(!p) return;
    if(owner !== btn){
      close();
      if(window.InfoCard) window.InfoCard.close();
      card = document.createElement('div');
      card.className = 'ic-card pc-card' + (p.group === 'ours' ? ' pc-ours' : '');
      card.setAttribute('role', 'dialog');
      card.innerHTML = cardHTML(p);
      card.addEventListener('mouseenter', function(){ clearTimeout(closeTimer); });
      card.addEventListener('mouseleave', function(){ if(!pinned) scheduleClose(); });
      card.addEventListener('click', function(){ pinned = true; card.classList.add('pinned'); });
      document.body.appendChild(card);
      owner = btn;
      btn.setAttribute('aria-expanded', 'true');
    }
    pinned = pinned || !!pin;
    card.classList.toggle('pinned', pinned);
    place();
  }

  function scheduleClose(){
    clearTimeout(closeTimer);
    closeTimer = setTimeout(function(){ if(!pinned) close(); }, CLOSE_DELAY);
  }

  /* hover: real mouse only, so a tap never opens-then-toggles */
  document.addEventListener('pointerover', function(e){
    if(e.pointerType !== 'mouse') return;
    var btn = e.target.closest && e.target.closest('.lp-name');
    if(!btn || btn.contains(e.relatedTarget)) return;
    clearTimeout(closeTimer);
    if(pinned && owner !== btn) return;
    clearTimeout(openTimer);
    openTimer = setTimeout(function(){ open(btn, false); }, OPEN_DELAY);
  });
  document.addEventListener('pointerout', function(e){
    if(e.pointerType !== 'mouse') return;
    var btn = e.target.closest && e.target.closest('.lp-name');
    if(!btn || btn.contains(e.relatedTarget)) return;
    clearTimeout(openTimer);
    if(owner === btn && !pinned) scheduleClose();
  });

  /* click or tap pins; a second click on a pinned name closes it */
  document.addEventListener('click', function(e){
    var btn = e.target.closest && e.target.closest('.lp-name');
    if(btn){
      e.preventDefault();
      if(owner === btn && pinned) close(); else open(btn, true);
    } else if(card && !card.contains(e.target)){
      close();
    }
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && card){ var o = owner; close(); if(o) o.focus(); }
  });
  /* keyboard focus behaves like hover */
  document.addEventListener('focusin', function(e){
    var btn = e.target.closest && e.target.closest('.lp-name');
    if(btn && btn.matches(':focus-visible') && !pinned) open(btn, false);
  });

  /* the card is viewport-fixed: follow the name on vertical page scroll,
     close if the matrix scrolls sideways or the name leaves the screen */
  window.addEventListener('scroll', function(e){
    if(!card) return;
    if(e.target && e.target.nodeType === 1 && card.contains(e.target)) return;
    if(e.target && e.target.id === 'mx-scroll'){ close(); return; }
    var r = owner.getBoundingClientRect();
    if(r.bottom < 0 || r.top > window.innerHeight){ close(); return; }
    place();
  }, true);
  window.addEventListener('resize', function(){ if(card) place(); });

  window.PaperCard = { close: close };
})();

/* ------------------------------------- sticky header collapse (as simulator) -- */
(function(){
  var sentinel = document.getElementById('hdr-sentinel');
  var topbar = document.getElementById('topbar');
  if(sentinel && topbar && 'IntersectionObserver' in window){
    new IntersectionObserver(function(entries){
      topbar.classList.toggle('is-stuck', !entries[0].isIntersecting);
    }, {threshold:0}).observe(sentinel);
  }
})();
