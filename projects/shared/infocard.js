"use strict";
/* =============================================================================
   INFOCARD.JS  (shared across project sites)
   -----------------------------------------------------------------------------
   Behaviour for the (i) info buttons styled by infocard.css. One card is open
   at a time; it closes on a second click of its button, a click anywhere
   outside it, the Escape key, or scroll/resize (its position is viewport-
   fixed). Safe to include in <head>: it only delegates document events and
   exposes window.InfoCard immediately.

   Usage:
     1. Static markup, plain-text body:
          <button type="button" class="ic-btn" aria-expanded="false"
                  data-ic-title="Title" data-ic-body="Short explanation">i</button>
     2. Static markup, rich (HTML) body kept in the page:
          <button type="button" class="ic-btn" aria-expanded="false"
                  data-ic-content="my-hidden-span">i</button>
          <span id="my-hidden-span" hidden>Anything, incl. <code>math</code>.</span>
        (data-ic-title is optional in both forms; an untitled card shows body only.)
     3. From script (escapes the strings for you):
          host.innerHTML = 'Advice frequency ' + InfoCard.buttonHTML(title, body);
   Buttons work inside <label>/<summary> hosts: the click is defaulted-prevented,
   so it never ticks the input or folds the disclosure.
   ============================================================================= */
(function(){
  var card = null, owner = null, openedAt = 0;

  function escAttr(s){
    return String(s)
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function close(){
    if(card && card.parentNode) card.parentNode.removeChild(card);
    if(owner) owner.setAttribute('aria-expanded', 'false');
    card = null; owner = null;
  }

  function open(btn){
    close();
    card = document.createElement('div');
    card.className = 'ic-card';
    card.setAttribute('role', 'note');
    card.innerHTML =
      '<div class="ic-title"></div><div class="ic-body"></div>';
    card.querySelector('.ic-title').textContent = btn.getAttribute('data-ic-title') || '';
    var src = btn.getAttribute('data-ic-content');
    var srcEl = src && document.getElementById(src);
    if(srcEl){
      card.querySelector('.ic-body').innerHTML = srcEl.innerHTML;
    } else {
      card.querySelector('.ic-body').textContent = btn.getAttribute('data-ic-body') || '';
    }
    document.body.appendChild(card);

    /* position: below the button, clamped to the viewport; above if no room */
    var r = btn.getBoundingClientRect(), gap = 8, margin = 8;
    var w = card.offsetWidth, h = card.offsetHeight;
    var left = Math.min(Math.max(r.left + r.width/2 - w/2, margin),
                        window.innerWidth - w - margin);
    var top = r.bottom + gap;
    if(top + h > window.innerHeight - margin && r.top - gap - h > margin){
      top = r.top - gap - h;
    }
    card.style.left = Math.round(left) + 'px';
    card.style.top = Math.round(top) + 'px';

    owner = btn;
    openedAt = Date.now();
    btn.setAttribute('aria-expanded', 'true');
  }

  document.addEventListener('click', function(e){
    var btn = e.target.closest ? e.target.closest('.ic-btn') : null;
    if(btn){
      e.preventDefault();  // keep <label>/<summary> hosts inert
      if(owner === btn){ close(); } else { open(btn); }
    } else if(card && !card.contains(e.target)){
      close();
    }
  });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape') close(); });
  // the card is viewport-fixed, so it detaches from its button when the page
  // scrolls — close it. Ignore scroll events landing right after open (late
  // async delivery of the scroll that brought the button into view).
  window.addEventListener('scroll', function(){ if(Date.now() - openedAt > 250) close(); }, true);
  window.addEventListener('resize', close);

  window.InfoCard = {
    close: close,
    buttonHTML: function(title, body){
      return '<button type="button" class="ic-btn" aria-expanded="false" ' +
        'aria-label="How this is measured" data-ic-title="' + escAttr(title) +
        '" data-ic-body="' + escAttr(body) + '">i</button>';
    }
  };
})();
