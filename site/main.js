/* CostObs site interactions: terminal hero animation, code tabs,
   copy buttons, scroll reveals, docs scrollspy. No dependencies. */

(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- scroll reveal ---------------------------------------------------- */
  var revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('on');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('on'); });
  }

  /* ---- code tabs ---------------------------------------------------------- */
  document.querySelectorAll('[data-tabs]').forEach(function (root) {
    root.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-tab');
        root.querySelectorAll('.tab').forEach(function (b) {
          b.classList.toggle('on', b === btn);
        });
        root.querySelectorAll('[data-pane]').forEach(function (p) {
          p.classList.toggle('on', p.getAttribute('data-pane') === key);
        });
      });
    });
  });

  /* ---- copy buttons ------------------------------------------------------- */
  document.querySelectorAll('pre.code[data-copy]').forEach(function (pre) {
    var btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'copy';
    btn.addEventListener('click', function () {
      navigator.clipboard.writeText(pre.textContent.trim()).then(function () {
        btn.textContent = 'copied';
        setTimeout(function () { btn.textContent = 'copy'; }, 1400);
      });
    });
    pre.appendChild(btn);
  });

  /* ---- docs scrollspy ------------------------------------------------------ */
  var docsNav = document.querySelector('.docs-nav');
  if (docsNav) {
    var links = Array.prototype.slice.call(docsNav.querySelectorAll('a[href^="#"]'));
    var targets = links
      .map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); })
      .filter(Boolean);
    var setActive = function () {
      var pos = window.scrollY + 110;
      var current = targets[0];
      targets.forEach(function (t) { if (t.offsetTop <= pos) current = t; });
      links.forEach(function (a) {
        a.classList.toggle('on', current && a.getAttribute('href') === '#' + current.id);
      });
    };
    window.addEventListener('scroll', setActive, { passive: true });
    setActive();
  }

  /* ---- terminal hero ------------------------------------------------------- */
  var term = document.getElementById('term');
  if (!term) return;

  var typedLines = [
    { html: '<span class="prompt">$</span> pip install costobs', delay: 0 },
    { html: '<span class="prompt">&gt;&gt;&gt;</span> client = costobs.<span class="cyan">wrap</span>(OpenAI(), team=<span class="amber">"payments"</span>)', delay: 600 },
    { html: '<span class="dim"># calls go straight to the provider — costobs only listens</span>', delay: 1100 },
  ];

  var events = [
    ['cust-19 · summarize · gpt-5.2', 0.0214],
    ['cust-04 · chat · claude-fable-5', 0.0381],
    ['cust-32 · extract · gpt-5-mini', 0.0027],
    ['cust-19 · classify · gemini-3-pro', 0.0098],
    ['cust-11 · chat · claude-haiku-4-5', 0.0042],
    ['cust-27 · translate · grok-4', 0.0156],
    ['cust-04 · summarize · gpt-5.2', 0.0233],
    ['cust-08 · voice · nova-3', 0.0061],
  ];

  function el(tag, cls, html) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  function money(n) { return '$' + n.toFixed(4); }

  if (reduceMotion) {
    // Static rendering: everything visible at once.
    typedLines.forEach(function (l) { term.appendChild(el('div', 'ln', l.html)); });
    var tick = el('div', 'ticker');
    var sum = 0;
    events.slice(0, 5).forEach(function (ev) {
      sum += ev[1];
      var row = el('div', 'ticker-row');
      row.style.animation = 'none';
      row.style.opacity = '1';
      row.appendChild(el('span', 'who', ev[0]));
      row.appendChild(el('span', 'cost', money(ev[1])));
      tick.appendChild(row);
    });
    var total = el('div', 'ticker-total');
    total.appendChild(el('span', null, 'attributed spend'));
    total.appendChild(el('span', 'sum', money(sum)));
    tick.appendChild(total);
    term.appendChild(tick);
    return;
  }

  // Animated: type lines, then stream attribution rows on a loop.
  typedLines.forEach(function (l) {
    setTimeout(function () { term.appendChild(el('div', 'ln', l.html)); }, l.delay);
  });

  setTimeout(function () {
    var tick = el('div', 'ticker');
    term.appendChild(tick);

    var totalRow = el('div', 'ticker-total');
    var sumEl = el('span', 'sum', '$0.0000');
    totalRow.appendChild(el('span', null, 'attributed spend'));
    totalRow.appendChild(sumEl);

    var sum = 0;
    var i = 0;
    var maxRows = 6;

    function pump() {
      var ev = events[i % events.length];
      i++;
      sum += ev[1];

      var row = el('div', 'ticker-row');
      row.appendChild(el('span', 'who', ev[0]));
      row.appendChild(el('span', 'cost', money(ev[1])));
      tick.insertBefore(row, totalRow.parentNode === tick ? totalRow : null);
      if (totalRow.parentNode !== tick) tick.appendChild(totalRow);

      // Keep the window tidy.
      var rows = tick.querySelectorAll('.ticker-row');
      if (rows.length > maxRows) tick.removeChild(rows[0]);

      sumEl.textContent = money(sum);
      setTimeout(pump, 900 + Math.random() * 900);
    }
    pump();
  }, 1800);
})();
