/**
 * Unified MQTT + room helpers for all 2-player arcade games.
 * Load order: mqtt.min.js → arcade-mqtt.js → arcade-connect.js → arcade-room-pick.js
 */
(function (global) {
  'use strict';

  var MQTT_CDN = 'https://unpkg.com/mqtt/dist/mqtt.min.js';

  var TWO_PLAYER_GAMES = [
    { key: 'pong', topicPrefix: 'pong', hostId: 'Man', guestId: 'Boy' },
    { key: 'tetris', topicPrefix: 'tetris', hostId: 'Man', guestId: 'Boy' },
    { key: 'tictactoe', topicPrefix: 'tictactoe', hostId: 'Man', guestId: 'Boy' },
    { key: 'mahjong', topicPrefix: 'mahjong', hostId: 'Man', guestId: 'Boy' },
    { key: 'scribble', topicPrefix: 'scribble', hostId: 'Man', guestId: 'Boy' },
  ];

  function getBrokers() {
    return global.ArcadeMqtt && global.ArcadeMqtt.BROKER_CANDIDATES
      ? global.ArcadeMqtt.BROKER_CANDIDATES.slice()
      : ['wss://broker.hivemq.com:8884/mqtt'];
  }

  function loadMqtt(cb) {
    if (global.mqtt) {
      cb(null);
      return;
    }
    var existing = global.document.querySelector('script[data-arcade-mqtt]');
    if (existing) {
      existing.addEventListener('load', function () {
        cb(global.mqtt ? null : new Error('mqtt load failed'));
      });
      existing.addEventListener('error', function () {
        cb(new Error('mqtt load failed'));
      });
      return;
    }
    var s = global.document.createElement('script');
    s.src = MQTT_CDN;
    s.setAttribute('data-arcade-mqtt', '1');
    s.onload = function () {
      cb(global.mqtt ? null : new Error('mqtt load failed'));
    };
    s.onerror = function () {
      cb(new Error('mqtt load failed'));
    };
    global.document.head.appendChild(s);
  }

  function slugify(raw) {
    if (global.ArcadeRoom && global.ArcadeRoom.slugify) {
      return global.ArcadeRoom.slugify(raw);
    }
    var s = String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return s || 'bens_arcade';
  }

  function getRoomId(gameKey) {
    if (global.ArcadeRoom && global.ArcadeRoom.getRoomId) {
      return global.ArcadeRoom.getRoomId(gameKey);
    }
    var p = new URLSearchParams(global.location.search);
    return slugify(p.get('room') || p.get('game') || 'bens_arcade');
  }

  function lobbyTopic(gameKey, slug) {
    return 'arcade/lobby/' + gameKey + '/room/' + slugify(slug);
  }

  function lobbySubscribeTopic(gameKey) {
    return 'arcade/lobby/' + gameKey + '/room/+';
  }

  function gameTopic(prefix, room, playerId, suffix) {
    return prefix + '/' + slugify(room) + '/' + playerId + '/' + suffix;
  }

  /**
   * Shared broker connect (uses ArcadeMqtt.connect).
   * opts.onConnected(client, brokerUrl)
   * opts.onMessage(topic, message)
   * opts.onBrokerStatus(status)
   */
  function connect(opts) {
    if (!global.ArcadeMqtt) {
      if (opts.onBrokerStatus) {
        opts.onBrokerStatus({
          brokerUrl: '—',
          brokerState: 'failed',
          attempt: 0,
          total: 0,
          lastError: 'arcade-mqtt.js not loaded',
          log: [],
        });
      }
      if (opts.onError) {
        opts.onError(new Error('ArcadeMqtt missing'));
      }
      return null;
    }
    return global.ArcadeMqtt.connect(opts);
  }

  /**
   * Lobby MQTT session for index pages (room list).
   */
  function createLobbySession(opts) {
    var gameKey = opts.gameKey || 'pong';
    var client = null;
    var connected = false;
    var brokerUrl = '';

    function setStatus(text, state) {
      if (opts.onStatus) {
        opts.onStatus({ text: text, state: state || 'unknown', brokerUrl: brokerUrl, connected: connected });
      }
    }

    function start() {
      loadMqtt(function (err) {
        if (err) {
          setStatus('MQTT script failed to load — use the same ?room= on both devices.', 'failed');
          return;
        }
        setStatus('Connecting to broker…', 'connecting');
        connect({
          mqttOptions: opts.mqttOptions || { reconnectPeriod: 5000, connectTimeout: 15000 },
          onBrokerStatus: function (st) {
            if (opts.onBrokerStatus) {
              opts.onBrokerStatus(st);
            }
            if (st.brokerState === 'connecting') {
              setStatus('Connecting room list (' + st.attempt + '/' + st.total + ')…', 'connecting');
            } else if (st.brokerState === 'failed') {
              connected = false;
              setStatus('Room list offline — use the same room name on both devices.', 'failed');
            } else if (st.brokerState === 'connected') {
              setStatus('Room list online', 'connected');
            }
          },
          onConnected: function (c, url) {
            client = c;
            connected = true;
            brokerUrl = url;
            c.subscribe(lobbySubscribeTopic(gameKey));
            setStatus('Watching for open rooms (' + url + ')', 'connected');
            if (opts.onConnected) {
              opts.onConnected(c, url);
            }
          },
          onMessage: function (topic, message) {
            if (opts.onMessage) {
              opts.onMessage(topic, message);
            }
          },
          onClose: function () {
            connected = false;
            setStatus('Room list reconnecting…', 'offline');
            if (opts.onClose) {
              opts.onClose();
            }
          },
          onError: function () {
            connected = false;
            setStatus('Room list offline — use the same room name on both devices.', 'failed');
          },
        });
      });
    }

    return {
      start: start,
      getClient: function () {
        return client;
      },
      isConnected: function () {
        return connected && client && client.connected;
      },
      publishRoom: function (slug, payload, retain) {
        if (!client || !client.connected) {
          return false;
        }
        var body = typeof payload === 'string' ? payload : JSON.stringify(payload);
        client.publish(lobbyTopic(gameKey, slug), body, { retain: retain !== false, qos: 0 });
        return true;
      },
      clearRoom: function (slug) {
        if (!client || !client.connected) {
          return false;
        }
        client.publish(lobbyTopic(gameKey, slug), '', { retain: true, qos: 0 });
        return true;
      },
    };
  }

  global.ArcadeConnect = {
    MQTT_CDN: MQTT_CDN,
    TWO_PLAYER_GAMES: TWO_PLAYER_GAMES,
    getBrokers: getBrokers,
    loadMqtt: loadMqtt,
    slugify: slugify,
    getRoomId: getRoomId,
    lobbyTopic: lobbyTopic,
    lobbySubscribeTopic: lobbySubscribeTopic,
    gameTopic: gameTopic,
    connect: connect,
    createLobbySession: createLobbySession,
  };
})(typeof window !== 'undefined' ? window : this);
