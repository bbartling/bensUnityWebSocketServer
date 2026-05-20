/**
 * MQTT room picker: Man or Boy can create a room; the other seat joins from the live list.
 * Lobby: arcade/lobby/{gameKey}/room/{slug} (retained). Used by pong, tetris, tictactoe, mahjong, scribble.
 */
(function (global) {
  'use strict';

  var STORAGE_PREFIX = 'arcade_room_';
  var BROKER_URL = 'wss://test.mosquitto.org:8081';
  var LOBBY_STALE_MS = 50000;
  var HOST_HEARTBEAT_MS = 12000;

  var ADJECTIVES = [
    'silly', 'bouncy', 'fuzzy', 'tiny', 'giant', 'speedy', 'sleepy', 'jumpy', 'wiggly',
    'sparkly', 'goofy', 'clumsy', 'happy', 'grumpy', 'sneaky', 'fluffy', 'dizzy', 'wobbly',
    'round', 'mighty', 'baby', 'cosmic', 'laser', 'giggly', 'peppy', 'zippy', 'snuggly',
    'bubbly', 'fizzy',
  ];
  var ANIMALS = [
    'penguin', 'mouse', 'elephant', 'llama', 'otter', 'octopus', 'badger', 'narwhal',
    'turtle', 'flamingo', 'hawk', 'squid', 'whale', 'raccoon', 'koala', 'hedgehog',
    'platypus', 'walrus', 'seal', 'crab', 'frog', 'newt', 'gecko', 'bunny', 'duck',
    'puffin', 'moose', 'beaver', 'iguana', 'parrot', 'worm', 'starfish',
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

  function getCard() {
    return global.document.querySelector('.card') || global.document.body;
  }

  function applyRoomToPage(gameKey, slug, manPath, boyPath) {
    var s = slugify(slug);
    try {
      global.sessionStorage.setItem(storageKey(gameKey), s);
    } catch (e) {
      /* ignore */
    }
    var q = '?room=' + encodeURIComponent(s);
    var card = getCard();
    card.querySelectorAll('a.a, a.b').forEach(function (a) {
      var h = a.getAttribute('href') || '';
      if (h.indexOf('man.html') !== -1) {
        a.setAttribute('href', manPath + q);
      }
      if (h.indexOf('boy.html') !== -1) {
        a.setAttribute('href', boyPath + q);
      }
    });
    card.querySelectorAll('a.a, a.b').forEach(function (a) {
      a.classList.remove('arcade-room-join-now');
    });
  }

  function highlightSeat(seat) {
    var card = getCard();
    if (seat === 'Boy') {
      card.querySelectorAll('a.b').forEach(function (a) {
        a.classList.add('arcade-room-join-now');
      });
    } else {
      card.querySelectorAll('a.a').forEach(function (a) {
        a.classList.add('arcade-room-join-now');
      });
    }
  }

  function showActive(root, slug, info) {
    var p = root.querySelector('.arcade-room-active');
    var c = root.querySelector('.arcade-room-code');
    var steps = root.querySelector('.arcade-room-steps');
    if (!p || !c) {
      return;
    }
    if (slugify(slug) === 'bens_arcade') {
      p.hidden = true;
      if (steps) {
        steps.hidden = true;
      }
      return;
    }
    p.hidden = false;
    c.textContent = slugify(slug);
    if (!steps) {
      return;
    }
    steps.hidden = false;
    var manStep = steps.querySelector('.arcade-room-step-man');
    var boyStep = steps.querySelector('.arcade-room-step-boy');
    var waiting = info && info.waitingSeat;
    var joinSeat = info && info.joinSeat;

    if (info && info.mode === 'create' && waiting) {
      if (waiting === 'Man') {
        if (manStep) {
          manStep.textContent = 'You → open MAN below';
        }
        if (boyStep) {
          boyStep.textContent = 'Friend → Join tab → open BOY';
        }
      } else {
        if (manStep) {
          manStep.textContent = 'Friend → Join tab → open MAN';
        }
        if (boyStep) {
          boyStep.textContent = 'You → open BOY below';
        }
      }
    } else if (info && info.mode === 'join' && joinSeat) {
      if (joinSeat === 'Boy') {
        if (manStep) {
          manStep.textContent = 'Friend is waiting on MAN';
        }
        if (boyStep) {
          boyStep.textContent = 'You → open BOY below';
        }
      } else {
        if (manStep) {
          manStep.textContent = 'You → open MAN below';
        }
        if (boyStep) {
          boyStep.textContent = 'Friend is waiting on BOY';
        }
      }
    }
  }

  function loadMqtt(cb) {
    if (global.mqtt) {
      cb();
      return;
    }
    var s = global.document.createElement('script');
    s.src = 'https://unpkg.com/mqtt/dist/mqtt.min.js';
    s.onload = function () {
      cb();
    };
    s.onerror = function () {
      cb(new Error('mqtt load failed'));
    };
    global.document.head.appendChild(s);
  }

  function mount(opts) {
    var root = global.document.getElementById(opts.rootId);
    if (!root) {
      return;
    }
    var manPath = opts.manPath || '/pong/man.html';
    var boyPath = opts.boyPath || '/pong/boy.html';
    var gameKey = opts.gameKey || 'pong';
    var enableLobby = opts.lobby !== false;
    var suggestions = uniqueSuggestions(4);
    var pickedSlug = '';
    var pickedLabel = '';
    var hostingSlug = '';
    var hostingSeat = 'Man';
    var lobbyClient = null;
    var openRooms = {};
    var hostHeartbeatTimer = null;

    root.className = 'arcade-room-pick';
    root.innerHTML =
      '<h2 class="arcade-room-pick-title">Play together (2 players)</h2>' +
      '<div class="arcade-room-modes">' +
      '<button type="button" class="arcade-room-mode is-active" data-mode="create">Create a room</button>' +
      '<button type="button" class="arcade-room-mode" data-mode="join">Join a friend</button>' +
      '</div>' +
      '<div class="arcade-room-panel" data-panel="create">' +
      '<p class="arcade-room-pick-hint">Pick a room name and which seat you are waiting on. Your friend uses <strong>Join a friend</strong> and takes the other seat.</p>' +
      '<fieldset class="arcade-room-seat-pick">' +
      '<legend>I am waiting as:</legend>' +
      '<label class="arcade-room-seat-label"><input type="radio" name="arcadeWaitSeat" value="Man" checked /> Man</label>' +
      '<label class="arcade-room-seat-label"><input type="radio" name="arcadeWaitSeat" value="Boy" /> Boy</label>' +
      '</fieldset>' +
      '<div class="arcade-room-suggestions"></div>' +
      '<div class="arcade-room-custom">' +
      '<label class="arcade-room-custom-label" for="arcadeRoomCustomInput">Room name:</label>' +
      '<input type="text" id="arcadeRoomCustomInput" class="arcade-room-input" maxlength="36" placeholder="space-pizza" autocomplete="off" />' +
      '</div>' +
      '<button type="button" class="arcade-room-create-btn">Create room &amp; wait</button>' +
      '</div>' +
      '<div class="arcade-room-panel" data-panel="join" hidden>' +
      '<p class="arcade-room-pick-hint">Tap a room — the badge shows which button to open (<strong>MAN</strong> or <strong>BOY</strong>).</p>' +
      '<p class="arcade-room-lobby-status">Connecting to room list…</p>' +
      '<ul class="arcade-room-open-list"></ul>' +
      '<p class="arcade-room-join-empty" hidden>No open rooms yet. Someone must <strong>Create a room</strong> first, or pick the same name on both devices.</p>' +
      '<button type="button" class="arcade-room-refresh-btn">Refresh list</button>' +
      '</div>' +
      '<p class="arcade-room-active" hidden><strong>Room:</strong> <code class="arcade-room-code"></code></p>' +
      '<ol class="arcade-room-steps" hidden>' +
      '<li class="arcade-room-step-man"></li>' +
      '<li class="arcade-room-step-boy"></li>' +
      '</ol>';

    function getWaitingSeat() {
      var checked = root.querySelector('input[name="arcadeWaitSeat"]:checked');
      return checked && checked.value === 'Boy' ? 'Boy' : 'Man';
    }

    function otherSeat(seat) {
      return seat === 'Man' ? 'Boy' : 'Man';
    }

    function updateCreateBtnLabel() {
      var btn = root.querySelector('.arcade-room-create-btn');
      if (!btn) {
        return;
      }
      var seat = getWaitingSeat();
      btn.textContent = 'Create room & wait for ' + otherSeat(seat);
    }

    root.querySelectorAll('input[name="arcadeWaitSeat"]').forEach(function (inp) {
      inp.addEventListener('change', updateCreateBtnLabel);
    });
    updateCreateBtnLabel();

    var sugRoot = root.querySelector('.arcade-room-suggestions');
    suggestions.forEach(function (s) {
      var btn = global.document.createElement('button');
      btn.type = 'button';
      btn.className = 'arcade-room-sug-btn';
      btn.textContent = s.label + ' · ' + s.slug;
      btn.addEventListener('click', function () {
        pickedSlug = s.slug;
        pickedLabel = s.label;
        var inp = root.querySelector('#arcadeRoomCustomInput');
        if (inp) {
          inp.value = s.slug;
        }
        applyRoomToPage(gameKey, s.slug, manPath, boyPath);
        showActive(root, s.slug, { mode: 'create', waitingSeat: getWaitingSeat() });
      });
      sugRoot.appendChild(btn);
    });

    function pickFromInput() {
      var inp = root.querySelector('#arcadeRoomCustomInput');
      var v = inp ? inp.value : '';
      pickedSlug = slugify(v);
      pickedLabel = v.trim() || pickedSlug;
      return pickedSlug;
    }

    function lobbyTopic(slug) {
      return 'arcade/lobby/' + gameKey + '/room/' + slugify(slug);
    }

    function lobbySubscribeTopic() {
      return 'arcade/lobby/' + gameKey + '/room/+';
    }

    function seatsFromWaiting(waitingSeat) {
      if (waitingSeat === 'Boy') {
        return { man: 'open', boy: 'waiting' };
      }
      return { man: 'waiting', boy: 'open' };
    }

    function publishRoom(slug, label, waitingSeat, manOverride, boyOverride) {
      if (!lobbyClient || !lobbyClient.connected) {
        return;
      }
      var seats = seatsFromWaiting(waitingSeat);
      var payload = JSON.stringify({
        slug: slugify(slug),
        label: label || slugify(slug),
        man: manOverride != null ? manOverride : seats.man,
        boy: boyOverride != null ? boyOverride : seats.boy,
        waitingSeat: waitingSeat,
        updated: Date.now(),
        gameKey: gameKey,
      });
      lobbyClient.publish(lobbyTopic(slug), payload, { retain: true, qos: 0 });
    }

    function clearRoom(slug) {
      if (!lobbyClient || !lobbyClient.connected) {
        return;
      }
      lobbyClient.publish(lobbyTopic(slug), '', { retain: true, qos: 0 });
    }

    function parseLobbyMessage(topic, message) {
      var parts = topic.split('/');
      var slug = parts[parts.length - 1];
      if (!slug) {
        return null;
      }
      var raw = message ? message.toString() : '';
      if (!raw) {
        delete openRooms[slug];
        return null;
      }
      try {
        var data = JSON.parse(raw);
        if (!data || slugify(data.slug || slug) !== slugify(slug)) {
          data = { slug: slug, label: slug, man: 'open', boy: 'open', updated: Date.now() };
        }
        data.slug = slugify(data.slug || slug);
        data.updated = data.updated || Date.now();
        if (!data.waitingSeat) {
          if (data.man === 'waiting' && data.boy === 'open') {
            data.waitingSeat = 'Man';
          } else if (data.boy === 'waiting' && data.man === 'open') {
            data.waitingSeat = 'Boy';
          }
        }
        openRooms[data.slug] = data;
        return data;
      } catch (e) {
        return null;
      }
    }

    function pruneStaleRooms() {
      var now = Date.now();
      Object.keys(openRooms).forEach(function (slug) {
        var r = openRooms[slug];
        if (!r || now - (r.updated || 0) > LOBBY_STALE_MS) {
          delete openRooms[slug];
        }
      });
    }

    function joinableRooms() {
      pruneStaleRooms();
      var out = [];
      Object.keys(openRooms).forEach(function (k) {
        var r = openRooms[k];
        if (!r) {
          return;
        }
        if (r.man === 'waiting' && (r.boy === 'open' || r.boy === 'joining')) {
          out.push({ room: r, joinSeat: 'Boy', badge: 'Open BOY', badgeClass: 'boy' });
        }
        if (r.boy === 'waiting' && (r.man === 'open' || r.man === 'joining')) {
          out.push({ room: r, joinSeat: 'Man', badge: 'Open MAN', badgeClass: 'man' });
        }
      });
      out.sort(function (a, b) {
        return (b.room.updated || 0) - (a.room.updated || 0);
      });
      return out;
    }

    function renderOpenList() {
      var list = root.querySelector('.arcade-room-open-list');
      var empty = root.querySelector('.arcade-room-join-empty');
      var status = root.querySelector('.arcade-room-lobby-status');
      if (!list) {
        return;
      }
      var entries = joinableRooms();
      list.innerHTML = '';
      if (status) {
        if (!lobbyClient || !lobbyClient.connected) {
          status.textContent = 'Room list offline — use the same room name on both devices.';
        } else {
          status.textContent =
            entries.length === 1 ? '1 open room' : entries.length + ' open rooms';
        }
      }
      if (empty) {
        empty.hidden = entries.length > 0;
      }
      entries.forEach(function (entry) {
        var r = entry.room;
        var li = global.document.createElement('li');
        var btn = global.document.createElement('button');
        btn.type = 'button';
        btn.className = 'arcade-room-join-btn arcade-room-join-btn--' + entry.badgeClass;
        btn.innerHTML =
          '<span class="arcade-room-join-label">' +
          (r.label || r.slug) +
          '</span>' +
          '<span class="arcade-room-join-slug">' +
          r.slug +
          '</span>' +
          '<span class="arcade-room-join-badge">' +
          entry.badge +
          '</span>';
        btn.addEventListener('click', function () {
          var joinSeat = entry.joinSeat;
          var waitSeat = otherSeat(joinSeat);
          applyRoomToPage(gameKey, r.slug, manPath, boyPath);
          showActive(root, r.slug, { mode: 'join', joinSeat: joinSeat });
          highlightSeat(joinSeat);
          if (joinSeat === 'Boy') {
            publishRoom(r.slug, r.label, waitSeat, 'waiting', 'joining');
          } else {
            publishRoom(r.slug, r.label, waitSeat, 'joining', 'waiting');
          }
        });
        li.appendChild(btn);
        list.appendChild(li);
      });
    }

    function stopHosting() {
      if (hostHeartbeatTimer) {
        global.clearInterval(hostHeartbeatTimer);
        hostHeartbeatTimer = null;
      }
      if (hostingSlug) {
        clearRoom(hostingSlug);
        hostingSlug = '';
        hostingSeat = 'Man';
      }
    }

    function startHosting(slug, label, waitingSeat) {
      stopHosting();
      hostingSlug = slugify(slug);
      hostingSeat = waitingSeat;
      publishRoom(hostingSlug, label, waitingSeat);
      hostHeartbeatTimer = global.setInterval(function () {
        publishRoom(hostingSlug, label, hostingSeat);
      }, HOST_HEARTBEAT_MS);
    }

    function setMode(mode) {
      root.querySelectorAll('.arcade-room-mode').forEach(function (btn) {
        btn.classList.toggle('is-active', btn.getAttribute('data-mode') === mode);
      });
      root.querySelectorAll('.arcade-room-panel').forEach(function (panel) {
        panel.hidden = panel.getAttribute('data-panel') !== mode;
      });
      if (mode === 'join') {
        renderOpenList();
      }
    }

    root.querySelectorAll('.arcade-room-mode').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setMode(btn.getAttribute('data-mode') || 'create');
      });
    });

    root.querySelector('.arcade-room-create-btn').addEventListener('click', function () {
      var slug = pickFromInput();
      if (!slug || slug === 'bens_arcade') {
        var s = randomSuggestion();
        slug = s.slug;
        pickedLabel = s.label;
        var inp = root.querySelector('#arcadeRoomCustomInput');
        if (inp) {
          inp.value = slug;
        }
      }
      var seat = getWaitingSeat();
      applyRoomToPage(gameKey, slug, manPath, boyPath);
      showActive(root, slug, { mode: 'create', waitingSeat: seat });
      highlightSeat(seat);
      startHosting(slug, pickedLabel || slug, seat);
      setMode('create');
    });

    root.querySelector('.arcade-room-refresh-btn').addEventListener('click', function () {
      renderOpenList();
    });

    global.addEventListener('beforeunload', function () {
      stopHosting();
      if (lobbyClient) {
        try {
          lobbyClient.end(true);
        } catch (e) {
          /* ignore */
        }
      }
    });

    function startLobby() {
      loadMqtt(function (err) {
        var status = root.querySelector('.arcade-room-lobby-status');
        if (err || !global.mqtt) {
          if (status) {
            status.textContent = 'Live room list unavailable — pick the same name on both devices.';
          }
          return;
        }
        lobbyClient = global.mqtt.connect(BROKER_URL, {
          reconnectPeriod: 5000,
          connectTimeout: 12000,
        });
        lobbyClient.on('connect', function () {
          lobbyClient.subscribe(lobbySubscribeTopic());
          if (status) {
            status.textContent = 'Watching for open rooms…';
          }
          renderOpenList();
        });
        lobbyClient.on('message', function (topic, message) {
          parseLobbyMessage(topic, message);
          renderOpenList();
        });
        lobbyClient.on('close', function () {
          if (status) {
            status.textContent = 'Room list reconnecting…';
          }
        });
      });
    }

    if (enableLobby) {
      startLobby();
      global.setInterval(function () {
        if (root.querySelector('.arcade-room-panel[data-panel="join"]').hidden === false) {
          renderOpenList();
        }
      }, 4000);
    }

    try {
      var existing = global.sessionStorage.getItem(storageKey(gameKey));
      if (existing && slugify(existing) !== 'bens_arcade') {
        applyRoomToPage(gameKey, existing, manPath, boyPath);
        showActive(root, existing, { mode: 'create', waitingSeat: 'Man' });
        pickedSlug = slugify(existing);
        pickedLabel = existing;
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
