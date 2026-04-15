/**
 * Silly kid-friendly room names for MQTT matchmaking (same ?room= on both seats).
 * Exposes window.ArcadeRoom: getRoomId, slugify, mount, rewritePartnerLinks.
 */
(function (global) {
  'use strict';

  var STORAGE_PREFIX = 'arcade_room_';

  var ADJECTIVES = [
    'silly',
    'bouncy',
    'fuzzy',
    'tiny',
    'giant',
    'speedy',
    'sleepy',
    'jumpy',
    'wiggly',
    'sparkly',
    'goofy',
    'clumsy',
    'happy',
    'grumpy',
    'sneaky',
    'fluffy',
    'dizzy',
    'wobbly',
    'round',
    'mighty',
    'baby',
    'cosmic',
    'laser',
    'giggly',
    'peppy',
    'zippy',
    'snuggly',
    'bubbly',
    'fizzy',
  ];
  var ANIMALS = [
    'penguin',
    'mouse',
    'elephant',
    'llama',
    'otter',
    'octopus',
    'badger',
    'narwhal',
    'turtle',
    'flamingo',
    'hawk',
    'squid',
    'whale',
    'raccoon',
    'koala',
    'hedgehog',
    'platypus',
    'walrus',
    'seal',
    'crab',
    'frog',
    'newt',
    'gecko',
    'bunny',
    'duck',
    'puffin',
    'moose',
    'beaver',
    'iguana',
    'parrot',
    'worm',
    'starfish',
  ];

  function slugify(raw) {
    var s = String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (s.length > 40) {
      s = s.slice(0, 40).replace(/-+$/g, '');
    }
    return s || 'bens_arcade';
  }

  function storageKey(gameKey) {
    return STORAGE_PREFIX + String(gameKey || 'game').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  }

  function getRoomId(gameKey) {
    var p = new URLSearchParams(global.location.search);
    var fromUrl = p.get('room') || p.get('game');
    if (fromUrl) {
      var slug = slugify(fromUrl);
      try {
        global.sessionStorage.setItem(storageKey(gameKey), slug);
      } catch (e) {
        /* ignore */
      }
      return slug;
    }
    var stored = null;
    try {
      stored = global.sessionStorage.getItem(storageKey(gameKey));
    } catch (err) {
      /* ignore */
    }
    if (stored) {
      return slugify(stored);
    }
    return 'bens_arcade';
  }

  function randomSuggestion() {
    var a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    var b = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    var label = a.charAt(0).toUpperCase() + a.slice(1) + ' ' + b.charAt(0).toUpperCase() + b.slice(1);
    var slug = slugify(a + '-' + b);
    return { label: label, slug: slug };
  }

  function uniqueSuggestions(count) {
    var out = [];
    var seen = {};
    var guard = 0;
    while (out.length < count && guard < 100) {
      guard++;
      var s = randomSuggestion();
      if (!seen[s.slug]) {
        seen[s.slug] = true;
        out.push(s);
      }
    }
    return out;
  }

  function applyRoomToPage(gameKey, slug, manPath, boyPath) {
    var s = slugify(slug);
    try {
      global.sessionStorage.setItem(storageKey(gameKey), s);
    } catch (e) {
      /* ignore */
    }
    var q = '?room=' + encodeURIComponent(s);
    var card = global.document.querySelector('.card') || global.document.body;
    card.querySelectorAll('a.a, a.b').forEach(function (a) {
      var h = a.getAttribute('href') || '';
      if (h.indexOf('man.html') !== -1) {
        a.setAttribute('href', manPath + q);
      }
      if (h.indexOf('boy.html') !== -1) {
        a.setAttribute('href', boyPath + q);
      }
    });
  }

  function showActive(root, slug) {
    var p = root.querySelector('.arcade-room-active');
    var c = root.querySelector('.arcade-room-code');
    if (!p || !c) {
      return;
    }
    if (slugify(slug) === 'bens_arcade') {
      p.hidden = true;
      return;
    }
    p.hidden = false;
    c.textContent = slugify(slug);
  }

  function mount(opts) {
    var root = global.document.getElementById(opts.rootId);
    if (!root) {
      return;
    }
    var manPath = opts.manPath || '/pong/man.html';
    var boyPath = opts.boyPath || '/pong/boy.html';
    var gameKey = opts.gameKey || 'pong';
    var suggestions = uniqueSuggestions(4);

    root.className = 'arcade-room-pick';
    root.innerHTML =
      '<h2 class="arcade-room-pick-title">Same game room</h2>' +
      '<p class="arcade-room-pick-hint">Pick a silly name together so you match each other ' +
      '(not the whole internet). Both open Man and Boy with the same room.</p>' +
      '<div class="arcade-room-suggestions"></div>' +
      '<div class="arcade-room-custom">' +
      '<label class="arcade-room-custom-label" for="arcadeRoomCustomInput">Or type your own:</label> ' +
      '<input type="text" id="arcadeRoomCustomInput" class="arcade-room-input" maxlength="36" ' +
      'placeholder="space-pizza" autocomplete="off" /> ' +
      '<button type="button" class="arcade-room-custom-btn">Use it</button>' +
      '</div>' +
      '<p class="arcade-room-active" hidden><strong>Room locked in:</strong> <code class="arcade-room-code"></code> ' +
      '<span class="arcade-room-tiny">— use the Man / Boy buttons below</span></p>';

    var sugRoot = root.querySelector('.arcade-room-suggestions');
    suggestions.forEach(function (s) {
      var btn = global.document.createElement('button');
      btn.type = 'button';
      btn.className = 'arcade-room-sug-btn';
      btn.textContent = s.label + ' · ' + s.slug;
      btn.addEventListener('click', function () {
        applyRoomToPage(gameKey, s.slug, manPath, boyPath);
        showActive(root, s.slug);
      });
      sugRoot.appendChild(btn);
    });

    root.querySelector('.arcade-room-custom-btn').addEventListener('click', function () {
      var inp = root.querySelector('#arcadeRoomCustomInput');
      var v = inp ? inp.value : '';
      var s = slugify(v);
      applyRoomToPage(gameKey, s, manPath, boyPath);
      showActive(root, s);
    });

    try {
      var existing = global.sessionStorage.getItem(storageKey(gameKey));
      if (existing && slugify(existing) !== 'bens_arcade') {
        applyRoomToPage(gameKey, existing, manPath, boyPath);
        showActive(root, existing);
      }
    } catch (e2) {
      /* ignore */
    }
  }

  function rewritePartnerLinks(gameKey, manPath, boyPath) {
    var slug = getRoomId(gameKey);
    if (slugify(slug) === 'bens_arcade') {
      return;
    }
    var q = '?room=' + encodeURIComponent(slugify(slug));
    var prefix = '/' + gameKey + '/';
    global.document.querySelectorAll('a[href]').forEach(function (a) {
      var h = a.getAttribute('href') || '';
      if (h.indexOf('http') === 0 || h.indexOf('mailto:') === 0) {
        return;
      }
      if (h.indexOf(prefix) !== -1 && h.indexOf('man.html') !== -1) {
        a.setAttribute('href', manPath + q);
      }
      if (h.indexOf(prefix) !== -1 && h.indexOf('boy.html') !== -1) {
        a.setAttribute('href', boyPath + q);
      }
    });
  }

  global.ArcadeRoom = {
    slugify: slugify,
    getRoomId: getRoomId,
    mount: mount,
    rewritePartnerLinks: rewritePartnerLinks,
  };
})(typeof window !== 'undefined' ? window : this);
