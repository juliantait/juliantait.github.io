# Simulator vs pilot: behavioural assumptions and an empirical parameter pack

**Date:** 2026-08-24. **Simulator snapshot:** `_ai/site_simulator_snapshot_2026-08-24/`
(`simulation.js` is the model, `game.js` + `index.html` the shell). **Pilot data:**
`data/data_pilot_cleaned.RData`, wave 1 (`prolific_wave1_2026-08-23`), completers only:
10 participants x 24 rounds = 240 task rows.

This document has four parts: (1) exactly what the simulator assumes, with the code
constants; (2) the same quantities estimated from wave-1 completers; (3) a gap table plus
what the gaps do to simulated group outcomes; (4) the field-by-field README for the
machine-readable pack `_ai/empirical_params_wave1.json`.

One-line summary of the mismatch: **the simulator's members are truthful Bayesians whose
only handicap is sample size; real participants are neither truthful nor unbiased. Novices
overreact to the signal, experts compress toward an even split, and both roles under-use
the 80/20 prior by about 20 points on the common Stable state.**

---

## 1. What the simulator assumes (from `simulation.js` / `game.js`)

The simulator is a **rational-OLS engine**, not a behavioural model of stated bets. Every
member is an unbiased estimator; the only thing that separates an EXPERT from a NOVICE is
how many data points they see.

### 1.1 Signal generation and the role difference
Each member observes `n` points `y_i = trueBeta * x_i + Normal(0, sigma^2)` and computes the
OLS slope. The role is **purely a sample size**:

```js
// game.js
var nNov  = Math.round(readParam('nNov', 4));    // NOVICE sample size (default 4)
var nExp  = Math.round(readParam('nExp', 80));    // EXPERT sample size (default 80)
var n = isExpert ? nExp : nNov;
var x = linspaceArr(0, 10, n);                     // fixed design 0..10
for (var i = 0; i < n; i++) y[i] = trueBeta * x[i] + sigma * norm();  // Gaussian noise
var betaHat = olsBetaHat(x, y);
var se = sigma / Math.sqrt(ssOfX(x));              // SE = sigma / sqrt(SS_x)
```

`sigma` default `1.5` (`readParam('sigma', 1.5)`). The estimator is **unbiased**: `betaHat`
is centred on `trueBeta`, so E[signal] = truth. There is no slope shrinkage, no
amplification, no anchoring. This matches the pilot's role construction (role sets only the
number of points seen, `n_points`), so the *mechanism* is right; what differs is behaviour.

### 1.2 Signal -> posterior -> stated view
The posterior over the candidate slopes is the exact Gaussian-times-prior rule, renormalised:

```js
// simulation.js posteriorOverCandidates()
const lik = sortedBetas.map(b => Math.exp(-0.5 * ((betaHat - b) / se) ** 2));
const unnorm = lik.map((v, i) => pri[i] * v);
const Z = unnorm.reduce((s, v) => s + v, 0);
return unnorm.map(v => v / Z);
```

In the Game the **optimal bet is defined to equal that posterior** (`game.js genRound()`:
`var posterior = posteriorOverCandidates(...)`, then the results screen overlays it as "the
optimal bet"). So the assumed mapping from posterior to stated bet is the **identity**:
truthful reporting, reaction slope **1.0**, intercept **0**, on the bet(0-100) vs
posterior(0-100) scale. There is **no over/underreaction parameter** anywhere in the code.

### 1.3 Noise distribution and magnitude
Only one noise source exists: the Gaussian measurement noise `sigma` in the data, which
propagates into `betaHat ~ Normal(trueBeta, se^2)` with `se = sigma / sqrt(SS_x)`. Given the
data, the member reports the posterior **deterministically**. There is **no idiosyncratic
response/execution noise** on top of the rational report: residual scatter of the stated bet
around the posterior line is assumed to be **zero**.

### 1.4 Base rate / prior
Candidate slopes and prior are fixed in `game.js`:

```js
var BETAS  = [-0.2, 0, 0.2];        // candidate true slopes
var PRIORS = [0.25, 0.5, 0.25];     // heavy-middle: P(0)=1/2, 1/4 each extreme
```

The prior enters the posterior, so the "optimal bet" **uses the base rate correctly**. Base-
rate neglect is represented only as a discrete *pick-rule* contrast on the Simulated-Groups
page: "nearest" (argmin |betaHat - beta_k|, prior-free) vs "most likely" (posterior mode,
prior-weighted). The info popover names the gap between them "base-rate neglect." Crucially
this is a **binary, all-or-nothing** switch applied to a discrete pick, **not a graded shift
added to the continuous bet**. The simulator's assumed base-rate-neglect shift on the bet is
**0 points**.

### 1.5 Herding / discussion dynamics
**None.** Members estimate independently from independent samples; there is no discussion
round, no social signal, no herding, no sequential revision. The pilot has no groups, so
this assumption **cannot be checked against pilot data** (stated explicitly, not invented).

### 1.6 Aggregation / voting rule and group composition
Groups are **1 EXPERT + (size - 1) NOVICES** (`N_NOVICES_PER_GROUP = size - 1`, default 2, so
a group of 3). Aggregation is a **precision-weighted mean of the continuous OLS estimates**,
then mapped to the nearest candidate, not a majority vote over discrete picks:

```js
// pooledGroupError(): weighted mean of member betaHats
const bbar = swb / sw;                       // Sum(w_i betaHat_i) / Sum(w_i)
const seGroup = Math.sqrt(swwse2) / sw;
const pick = nearestCandidate(bbar, sortedBetas);
```

Three weighting schemes are offered:
- **Optimal / precision:** `w_i proportional to tau_i = 1/se_i^2`.
- **Equal:** `w_i = 1` (1/3 each).
- **Behavioural:** `w_i proportional to tau_i^rho`, with `rho` in [-1, 1] a slider
  (`const wRho = ms.map(m => Math.pow(m.tau, rho))`); `rho=1` optimal, `rho=0` equal,
  `rho<0` counter-precision. A "strength" scheme `w_i = |betaHat - centre|` (over-weights
  extreme/noisy draws) is also shown for single realisations.

`rho` is the **only behavioural free parameter in the whole simulator**, and it lives at the
*aggregation* stage, not the individual-belief stage. There is no majority-vote counter and
no crowd-vs-expert accuracy comparison beyond the pooled-mean error.

### 1.7 Candidate grid
Simulator candidates are `{-0.2, 0, +0.2}` (symmetric around 0). The pilot is a **two-state**
world: Stable (slope 0) vs Growing (slope `beta_pos` in {0.02, 0.03}). Different cardinality
(3 vs 2), different magnitudes, and a different symmetry (symmetric vs one-sided-positive).

---

## 2. The same quantities, estimated from wave-1 completers

Outcome `allocation_pos_pct` (integer 0-100, points on Growing); normative benchmark
`posterior` (Bayesian P(Growing | data), 0-1). Reaction fits regress the bet on `100*posterior`
so the slope is on the same 0-100 scale the simulator's identity mapping implies (slope 1.0 =
truthful). Primary fits are pooled OLS per role on the 240 completer rows; the within-
participant mean slope is reported alongside because that is the spec that reproduces the
stated NOVICE anchor.

| Quantity | NOVICE | EXPERT |
|---|---|---|
| Reaction slope, pooled OLS | **1.315** | **0.397** |
| Reaction slope, within-participant mean | 1.517 | 0.458 |
| Reaction intercept (OLS) | 10.71 | 30.98 |
| Residual SD around the line (response noise) | **24.85 pts** | **21.40 pts** |
| Reaction R^2 | 0.420 | 0.204 |
| Base-rate-neglect shift on Stable draws | **+16.7 pts** | **+22.8 pts** |
| Corner share at 0 | 0.033 | 0.000 |
| Corner share at 50 | 0.017 | 0.025 |
| Corner share at 100 | 0.033 | 0.008 |
| Mean bet | 43.1 | 40.3 |
| SD of bets | **32.6** | **24.0** |
| n_points seen (evidence) | 3, 4, 5 | 15, 20, 30 |

**Reaction slope.** Novices **overreact**: the bet moves ~1.3-1.5 points per point of
posterior, above the truthful 1.0. Experts **severely underreact / compress**: ~0.4 points per
point of posterior. The within-participant NOVICE slope (1.517) matches the stated anchor of
~1.51 essentially exactly. The stated EXPERT anchor of ~0.28 is **lower than any wave-1
completer spec reproduces**: pooled OLS 0.397, within-participant 0.458, robust 0.414, interior-
posterior-only 0.341, precision-weighted 0.377, mixed random-slope 0.442. The direction
(strong underreaction, slope well below 1) is unambiguous; the exact 0.28 likely came from a
different sample or cut (e.g. all arrivals, or an earlier wave). I report 0.40 as the wave-1
completer estimate and flag the discrepancy rather than force-fitting it.

**Response noise.** Far from the simulator's zero: residual SD around each role's reaction
line is ~25 (NOVICE) and ~21 (EXPERT) bet points. Stated bets scatter widely around the
conditional mean; the deterministic-report assumption is badly violated.

**Base-rate neglect.** On Stable-state rounds (the common case, 80% prior), participants
place ~17 (NOVICE) to ~23 (EXPERT) **more** points on Growing than the Bayesian posterior
warrants. Pooled across roles the shift is **+19.7 points**, matching the stated "about 20
points." The prior is under-used, exactly the direction the simulator's "nearest" pick-rule
gestures at but never quantifies on the bet.

**Bet dispersion is reversed.** The simulator implies experts, with sharper posteriors,
produce **more** dispersed bets (posteriors nearer 0/1). Empirically the opposite holds:
NOVICE bet SD 32.6 > EXPERT 24.0, and experts hedge to the middle far more (28% of expert
bets fall in [40,60] vs 13% of novice bets). Overreaction plus noise makes the low-evidence
role the more extreme one.

**Corners.** Modest and asymmetric: novices hit 0 or 100 about 3% each; experts almost never
(0% at 0, <1% at 100) and instead pile near an even split. The simulator produces
near-zero corner mass because a continuous posterior rarely lands exactly on 0/50/100; the
empirical corner mass is small but non-zero and role-dependent.

**Cannot be estimated from the pilot (individual task, no groups):** discussion/herding
dynamics (Section 1.5) and the true group aggregation rule / rho (Section 1.6). Any group-
level claim below is an *extrapolation* from the individual parameters, flagged as such.

---

## 3. How far off is each assumption, and what it does to group outcomes

### 3.1 Gap table

| Assumption | Simulator value | Empirical (wave 1) | Gap | Matters for aggregates? |
|---|---|---|---|---|
| Reaction slope, NOVICE | 1.0 (truthful) | 1.32 (within 1.52) | +0.3 to +0.5, overreaction | **Yes** |
| Reaction slope, EXPERT | 1.0 (truthful) | 0.40 | -0.6, severe underreaction | **Yes** |
| Response noise (resid SD around line) | 0 (deterministic report) | ~25 NOV / ~21 EXP pts | Large | **Yes** |
| Base-rate-neglect shift on Stable | 0 pts (bet = full posterior) | +20 pts toward Growing | +20, common-mode | **Yes** |
| Bet dispersion by role | EXPERT > NOVICE (sharper posteriors) | NOVICE 32.6 > EXPERT 24.0 | Qualitative reversal | **Yes** |
| Corner mass at 0/50/100 | ~0 | NOV ~3-7%, EXP ~1-3% | Small, role-dependent | Minor |
| Prior | symmetric heavy-middle {-.2,0,.2}, 1/4-1/2-1/4 | asymmetric two-state, 0.8 Stable / 0.2 Growing | Structural | **Yes (context)** |
| Role mechanism | sample size only | sample size + role-specific reaction/bias | Partial match | **Yes** |
| Discussion / herding | none | not estimable (no groups) | Unknown | n/a |
| Aggregation rule / rho | precision-weighted mean pooling -> nearest | not estimable (no groups) | Unknown | n/a |

### 3.2 What the gaps imply for simulated GROUP outcomes

All statements below are extrapolations from the individual-level parameters; the pilot
cannot observe real groups.

- **The crowd runs away from the expert more often than the simulator shows.** Groups are 1
  EXPERT + many NOVICES. Real novices overreact (slope ~1.3-1.5) and add ~25 points of
  response noise, so the pooled novice signal swings further and more erratically than the
  simulator's truthful novices. A simulator that treats novices as unbiased low-precision
  estimators **understates how often the novice majority pulls the group estimate away from
  both the truth and the (cautious) expert**, especially on the common Stable state.

- **Base-rate neglect does not average out.** It is **common-mode**: both roles shift ~+20
  points toward Growing on Stable draws. Pooling independent estimates cancels *idiosyncratic*
  noise, not a *shared* bias, so the group mean inherits the full +20-point tilt. Simulated
  bias-free groups will look far better calibrated on Stable states (80% of rounds) than real
  ones. Any crowd-accuracy or majority-vote statistic the simulator reports on Stable states
  is optimistic.

- **Up-weighting the expert buys less than the simulator's precision scheme claims.** The
  "optimal = precision weighting" scheme assumes the high-precision expert also **reports
  truthfully**. Empirically the expert compresses to the middle (slope 0.40, bet SD 24, 28%
  of bets near even), so even a genuinely precise expert contributes a **muted** signal. The
  simulator therefore **overstates the accuracy gain from tilting weight toward the expert**,
  and the real expert-vs-crowd gap in decisiveness is smaller (and sometimes reversed in
  dispersion) than the sharp-posterior expert implies.

- **Dispersion reversal flips who looks like the outlier.** Because novices, not experts,
  produce the most extreme bets, the simulator's picture of "experts confident, novices
  timid" is inverted at the stated-bet level. A group-outcome model tuned on simulated
  dispersions will misjudge which members appear as outliers and thus how a
  strength-weighting ("trust the confident-looking member") scheme behaves.

Net: switching the site to the data-driven parameters should make simulated groups **less
accurate, more Growing-biased on Stable states, and less improved by expert up-weighting**
than the current rational-OLS defaults suggest.

---

## 4. README for `_ai/empirical_params_wave1.json`

A comment-free JSON pack for the site's data-driven toggle. Draw a `posterior` (either from
the site's own OLS engine or by sampling the empirical `per_arm` quantiles), then map it to a
bet with the role's reaction line plus noise, and clamp to [0, 100].

**Top-level fields**
- `schema` - version tag (`experts_empirical_params_v1`).
- `source` - data file and filter (completers only).
- `wave`, `wave_date` - provenance of these estimates.
- `n_completers` (10), `n_rounds_total` (240), `rounds_per_participant` (24).
- `bet_scale`, `posterior_scale` - unit reminders (bet 0-100 on Growing; posterior 0-1).
- `reaction_model` - the exact generative formula the site should use:
  `bet = intercept + slope * (100 * posterior) + Normal(0, residual_sd)`, then clamp [0,100].
- `base_rate_neglect_note` - definition of the Stable-shift field (positive = over-placement
  on Growing = prior under-used).
- `design_prior` - the pilot's two-state 0.8/0.2 prior (contrast with the simulator's
  symmetric {1/4,1/2,1/4}).
  **[Correction 2026-08-24, vs exp_pilots settings.py]** wave 1 actually ran at **0.75 / 0.25** (250 of 1000 islands Growing); the 0.8/0.2 quoted here and in the summary/gap table above is stale, and the reaction parameters were estimated against 0.75-posteriors — so the site's 0.75 prior is the pilot value, not an approximation.
- `growth_arms_beta_pos` - the two growth arms, {0.02, 0.03}.

**Per role (`roles.NOVICE`, `roles.EXPERT`)**
- `n_rows` - completer rounds for the role (120 each).
- `n_points_seen` - evidence sizes (NOVICE 3/4/5, EXPERT 15/20/30); this is the role
  mechanism, and it matches the simulator's sample-size role.
- `reaction_slope`, `reaction_intercept` - **pooled OLS**; the primary conditional-mean line
  for the generative formula.
- `reaction_slope_within_participant` - mean of within-participant slopes; steeper, and the
  spec that reproduces the stated NOVICE anchor (~1.51). Use if you want the anchor-matching
  slope instead of pooled OLS.
- `residual_sd` - SD of the response noise to inject (the simulator currently assumes 0).
- `reaction_r2` - fit quality of the reaction line.
- `corner_prob_0/50/100` - observed probability mass exactly at 0, 50, 100 (post-clamp mass
  should be checked against these).
- `mean_bet`, `sd_bet` - marginal bet moments for calibration/sanity checks (note SD_NOVICE >
  SD_EXPERT, the dispersion reversal).
- `base_rate_neglect_stable_shift` - mean(bet - 100*posterior) on Stable rounds, in points.
  If the site samples posteriors that already embed the prior, this shift is the extra
  behavioural tilt to add on Stable draws.
- `posterior_quantiles_05_10_25_50_75_90_95` - marginal posterior distribution for the role
  (pooled over arms), for sampling realistic signals.
- `per_arm["0.02"|"0.03"]` - `n`, `mean`, `sd`, and `quantiles_10_25_50_75_90` of the
  posterior within each growth arm, if per-cell sampling is wanted.

**Caveats to carry into the site copy:** (1) 10 completers, 240 rounds; these are pilot
magnitudes, not final estimates. (2) The EXPERT reaction slope here (0.40) is above the
project's stated ~0.28 anchor; the direction (strong underreaction) is solid, the exact value
is provisional. (3) No group, discussion, or aggregation parameter is in this pack because the
pilot has no groups; the site's group section must keep using an assumed rule (e.g. the `rho`
slider), not pretend these individual parameters pin it down.
