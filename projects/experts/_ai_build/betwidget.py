"""TWO-STEP BET WIDGET — the shared server half.

ONE elicitation, TWO steps (2026-08-17). The round's bet used to be a single
0-100 slider whose value was "points on Growing". It is now:

    STEP 1  a BINARY DIRECTION: Stable or Growing (allocation_direction)
    STEP 2  the SAME 100-point slider, restricted to one half of the scale

The slider keeps ``min=0 max=100`` so the physical centre of the track is still
the block point (50 at the shipped default), and the recorded field
``allocation_pos_pct`` still means POINTS ON GROWING — nothing downstream
(scoring.py, task_records, the payment draw, the exports) changes meaning.

    Direction GROWING  ->  allocation_pos_pct in [block, 100]
    Direction STABLE   ->  allocation_pos_pct in [0, block]

THE BLOCK POINT IS REACHABLE FROM BOTH DIRECTIONS (both ranges are inclusive):
"50 points on each" is the honest statement of "I genuinely cannot tell", and a
participant must be able to make it whichever button they pressed. That is why
the two ranges overlap at exactly one value rather than partitioning the scale.

THERE IS NO STARTING VALUE. The old control opened at the prior
(settings.slider_start, retired in this change), so an untouched submission
silently recorded a bet the participant never made. Now nothing is pre-filled:
no thumb is shown and both readout numbers are em-dashes until the participant
moves the slider, and a missing bet is REJECTED (see validate() below) instead
of being scored.

WHY THE REQUIREMENT LIVES HERE AND NOT IN oTree'S OWN `required`
----------------------------------------------------------------
Both fields are ``blank=True`` at the MODEL level and required in the page's
``error_message``, the same pattern the comprehension quiz and the exit battery
already use (intro.make_quiz_fields / outro.exit_battery). oTree's own required
can only produce the bare "Please fix the errors." banner, which names nothing;
enforcing it here lets the page say WHICH step is missing and WHAT TO DO about
it. A form property, not a column property — no column type changes.

NOTHING HERE HARD-CODES 50. The block point is the session-config parameter
``bet_block_point`` (settings.DESIGN_DEFAULTS), read through safe_config so a
session created before the parameter existed falls back to the shipped default
instead of 500-ing. The template renders it into a data attribute and elicit.js
reads it from there; no template and no JS carries the number.
"""

from otree.api import models

# The two directions, as stored. Participant-facing wording ("Stable" /
# "Growing") lives in the widget partial; these are the column values, named
# once here so the model choices, the validator, the quiz answer and the bots
# cannot drift.
STABLE = 'STABLE'
GROWING = 'GROWING'
DIRECTION_CHOICES = [STABLE, GROWING]

# The field name, in one place (the same single-source idiom as
# devicecapture.TASK_METRIC_FIELDS / slidertrace.SLIDER_TRACE_FIELDS).
DIRECTION_FIELD = 'allocation_direction'
BET_FIELD = 'allocation_pos_pct'

# safe_config's fallback for a session created before `bet_block_point` existed.
# The shipped value lives in settings.DESIGN_DEFAULTS (the single source of
# truth); this constant exists only so a frozen old config cannot 500 the page.
DEFAULT_BLOCK_POINT = 50

# The em-dash both readout numbers show until the participant has set a bet.
# One constant so the template, the JS (which is handed it in a data attribute)
# and any test all mean the same character.
UNSET_DISPLAY = '—'

# STEP 2'S HEADING, IN ONE PLACE — the same rule as main.LOCK_NOTE_TPL.
#
# It names the direction the participant actually chose ("How confident are you
# that it is growing?"), because a generic "How confident are you?" leaves the
# slider's meaning to be inferred from the readout labels — and the whole point
# of splitting the elicitation in two is that the second question is ABOUT the
# answer to the first.
#
# The template goes to the client as-is in a data attribute and the script only
# substitutes {type}, exactly as the forced-view countdown substitutes {s}.
# NEVER build this sentence in JavaScript: one source means the reserved first
# frame and every later frame cannot drift apart, and a drift would change the
# heading's height and reintroduce the layout jump.
CONFIDENCE_TPL = 'How confident are you that it is {type}?'

# The participant-facing word for each direction, as it reads INSIDE that
# sentence (lower case, mid-sentence). Distinct from the button captions, which
# are title case; kept here so neither the template nor the JS types either one.
DIRECTION_WORDS = {STABLE: 'stable', GROWING: 'growing'}


def confidence_heading(direction):
    """The step 2 heading for a direction, or — when none has been chosen — the
    LONGEST of the two renderings (so a first view still has a full sentence to
    render, which the ghost below then matches)."""
    word = DIRECTION_WORDS.get(direction)
    if word is None:
        word = max(DIRECTION_WORDS.values(), key=len)
    return CONFIDENCE_TPL.replace('{type}', word)


def confidence_reserve():
    """The rendering the heading's box is SIZED BY: the longest of the two,
    always, whatever direction is chosen.

    The heading is hidden with CSS `visibility`, never `display: none` — its box
    has to be in flow at full height from the first paint or it pushes the bet
    control down when the participant clicks, which is the exact bug the
    forced-view countdown pill already had on this screen.

    But reserving with the LIVE element is only safe while the sentence revealed
    is never shorter than the one reserved, and the two directions are different
    lengths: at a width where "growing" wraps to two lines and "stable" does not,
    the box would SHRINK on choosing Stable — the same jump upside down. So the
    template sizes the box with a permanently-invisible ghost carrying THIS
    string and lays the live sentence over it out of flow. The height is then the
    taller variant's at every width, structurally rather than by luck.
    """
    return CONFIDENCE_TPL.replace(
        '{type}', max(DIRECTION_WORDS.values(), key=len))

# THE NO-JAVASCRIPT DEFAULT DIRECTION — load-bearing, and NOT a starting value.
#
# A radio posts nothing unless it is rendered `checked`, so a first view with
# neither button checked leaves a scriptless participant unable to answer step 1
# at all: they would be refused on every submit with no way forward. That is the
# stranding CLAUDE.md's no-JS rule exists to prevent, so ONE button is rendered
# checked server-side and elicit.js UNCHECKS IT ON LOAD — the same
# "render usable, let the script lock it down" shape as the shield below.
#
# It is safe precisely because of the overlap at the block point: a scriptless
# browser posts this direction together with the range's own HTML default (the
# midpoint of min..max), and the midpoint is legal from BOTH halves, so the pair
# a scriptless client sends is always self-consistent whichever button carries
# the default. Those rows are identifiable afterwards by main.Player.js_ran_task
# (jsrun.py), which reads '0' for them.
#
# Stable is the default because it is the left/first button and the prior-heavy
# type; at the block point the direction barely constrains the bet anyway (the
# points are even), so the choice is close to arithmetically neutral. It is NOT
# an opening position for the BET: the range still carries no value attribute.
DEFAULT_NOJS_DIRECTION = STABLE


def bet_block_point(cfg):
    """The scale's block point (points on Growing), 0-100.

    `cfg` must already be a safe_config wrapper, so a session predating the
    parameter falls back to the shipped default. A malformed value degrades to
    the default rather than raising: this is read on every task-page render.
    """
    try:
        value = int(cfg['bet_block_point'])
    except (TypeError, ValueError, KeyError):
        value = DEFAULT_BLOCK_POINT
    return max(0, min(100, value))


def direction_player_fields():
    """The ``allocation_direction`` column, merged onto a Player with
    ``locals().update(direction_player_fields())`` — declared identically on
    main.Player (one row per round) and intro.Player (the quiz's hands-on item)
    so the shared widget partial binds to the same name on both.

    ``blank=True`` because the requirement is enforced in ``error_message``
    (see the module docstring); ``choices`` still bounds what can be STORED, so
    a tampered post cannot put an unknown string in the column.
    """
    return dict(
        allocation_direction=models.StringField(
            blank=True, choices=DIRECTION_CHOICES),
    )


def direction_for_bet(cfg, bet):
    """The direction a given points-on-Growing value belongs to.

    Used to DERIVE the comprehension quiz's direction answer from the item's
    existing bet answer, so the two can never contradict each other and neither
    is typed twice. AT THE BLOCK POINT BOTH DIRECTIONS ARE LEGAL, and this
    resolves the tie to Stable — an arbitrary but fixed choice, and one no
    shipped quiz item depends on (the item asks for 73 points on Stable, i.e.
    27 on Growing, well inside the Stable half). If an item is ever authored AT
    the block point, give it an explicit direction rather than relying on this.
    """
    return STABLE if int(bet) <= bet_block_point(cfg) else GROWING


def allowed_range(cfg, direction):
    """(low, high) inclusive bounds on allocation_pos_pct for a direction, or
    None if the direction is not one of the two."""
    block = bet_block_point(cfg)
    if direction == GROWING:
        return block, 100
    if direction == STABLE:
        return 0, block
    return None


# ---------------------------------------------------------------------------
# VALIDATION — plain messages that NAME WHAT TO DO
# ---------------------------------------------------------------------------
# Returned from the task screen's and the quiz's error_message. Each says which
# of the two steps is unfinished and how to finish it; none of them says only
# that something is wrong.

MSG_DIRECTION_MISSING = (
    'Choose "Stable" or "Growing" first, then set your bet with the slider.')
MSG_BET_MISSING = (
    'Now set your bet: move the slider to show how confident you are.')


def msg_inconsistent(cfg, direction):
    """The message for a bet that contradicts the chosen direction. Names the
    direction the participant picked and the range that goes with it, both
    derived from the config — nothing typed."""
    bounds = allowed_range(cfg, direction)
    if bounds is None:
        return MSG_DIRECTION_MISSING
    low, high = bounds
    word = 'Growing' if direction == GROWING else 'Stable'
    return (f'Your bet does not match your choice of "{word}". With "{word}" '
            f'chosen, your points on Growing must be between {low} and {high}. '
            'Move the slider, or change your choice above.')


def validate(cfg, values, direction_field=DIRECTION_FIELD, bet_field=BET_FIELD):
    """The two-step requirement, for a page's ``error_message``.

    Returns None when the submission carries a direction AND a bet that is
    consistent with it, else the plain message to show. `values` is oTree's
    submitted-values dict; `cfg` must already be a safe_config wrapper.

    The three rejections are deliberately ordered the way the participant fills
    the control in: no direction, then no bet, then a bet that contradicts the
    direction. Naming the LAST unfinished step is what stops the page telling
    someone to fix something they have not reached yet.
    """
    direction = values.get(direction_field)
    if direction not in DIRECTION_CHOICES:
        return MSG_DIRECTION_MISSING
    bet = values.get(bet_field)
    if bet is None or bet == '':
        return MSG_BET_MISSING
    try:
        bet = int(bet)
    except (TypeError, ValueError):
        return MSG_BET_MISSING
    low, high = allowed_range(cfg, direction)
    if not (low <= bet <= high):
        return msg_inconsistent(cfg, direction)
    return None


# ---------------------------------------------------------------------------
# RE-RENDERING A REJECTED SUBMISSION
# ---------------------------------------------------------------------------
# The widget is rendered BY HAND (not through oTree's ``{{ field }}``), so oTree
# does not repopulate it on a rejected submission — the control would silently
# jump back to its empty state while the page said the answers had been kept.
# That is fuzz finding F1 (intro/__init__.py carries the full history); the same
# trap now applies to BOTH steps and to BOTH pages that can reject, so the read
# lives here and both pages call it.
#
# DEFENSIVE BY DESIGN: no form, no such field, no raw data or an unparseable
# value all return None and the caller falls back to the unset state.
# Re-rendering a page must never be able to raise — that would turn a rejected
# attempt into a 500.

def _raw(form, field):
    try:
        raw = getattr(form[field], 'raw_data', None)
        if not raw:
            return None
        return str(raw[0]).strip()
    except Exception:
        return None


def submitted(form):
    """(direction, bet) that THIS submission actually carried, from the BOUND
    form; either may be None. oTree binds the posted data on both rejection
    paths (the field-level one, where error_message never runs, and
    error_message's own), so this sees what the participant sent whichever way
    the page came back."""
    if form is None:
        return None, None
    direction = _raw(form, DIRECTION_FIELD)
    if direction not in DIRECTION_CHOICES:
        direction = None
    bet = _raw(form, BET_FIELD)
    try:
        bet = int(bet) if bet not in (None, '') else None
    except (TypeError, ValueError):
        bet = None
    if bet is not None and not (0 <= bet <= 100):
        bet = None
    return direction, bet


# ---------------------------------------------------------------------------
# TEMPLATE VARS
# ---------------------------------------------------------------------------

def widget_vars(cfg, direction=None, bet=None):
    """Everything main/widget_allocation.html needs, for every page that
    includes it (the task screen, the instructions practice demo and the quiz's
    hands-on item), so the three can never drift.

    `direction` / `bet` are the values to RE-RENDER at (from submitted() on a
    rejected attempt); both None is the normal first view, i.e. the unset state
    with no thumb and two em-dashes.
    """
    block = bet_block_point(cfg)
    has_bet = bet is not None
    # Which button is rendered `checked`. On a re-render it is the one the
    # participant actually chose; on a FIRST VIEW it is the no-JS default (see
    # DEFAULT_NOJS_DIRECTION), which elicit.js clears on load. `bet_direction`
    # stays EMPTY on a first view and is what tells the script the difference —
    # a checked button alone cannot, and adopting the default as a real choice
    # would answer step 1 for every scripted participant too.
    checked = direction or DEFAULT_NOJS_DIRECTION
    return {
        # read by elicit.js from a data attribute — the number is never typed
        # into a template or into the JS (CLAUDE.md's no-hardcoded-quantities
        # rule applies to the client too).
        'bet_block_point': block,
        'bet_direction': direction or '',
        'bet_direction_stable': checked == STABLE,
        'bet_direction_growing': checked == GROWING,
        # the two stored values, so the template never types them either
        'dir_stable_value': STABLE,
        'dir_growing_value': GROWING,
        # ...and the word each one reads as inside step 2's heading. Handed to
        # the client on the radios themselves (data-word), so the script has
        # both halves of the sentence from the server and only substitutes.
        'dir_stable_word': DIRECTION_WORDS[STABLE],
        'dir_growing_word': DIRECTION_WORDS[GROWING],
        # STEP 2'S HEADING. The template for the client, the rendered first
        # frame for the server, and whether it is SHOWN yet. With no direction
        # chosen the sentence is still rendered (the longest of the two) and
        # merely hidden with `visibility`, so its box is reserved before any
        # script runs — see confidence_heading().
        'bet_step2_tpl': CONFIDENCE_TPL,
        'bet_step2_initial': confidence_heading(direction),
        'bet_step2_visible': direction in DIRECTION_CHOICES,
        # what SIZES the heading's box, in every state — see confidence_reserve()
        'bet_step2_reserve': confidence_reserve(),
        # '' (not 0) when unset: the range input must render with NO value
        # attribute at all, so nothing pre-fills the control.
        'bet_value': bet if has_bet else '',
        # the two live numbers: em-dashes until there IS a bet
        'bet_pos_display': bet if has_bet else UNSET_DISPLAY,
        'bet_stable_display': (100 - bet) if has_bet else UNSET_DISPLAY,
        'bet_unset': not has_bet,
        'bet_unset_display': UNSET_DISPLAY,
    }
