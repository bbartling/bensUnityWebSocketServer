/**
 * Shared 2-player game MQTT session (Man/Boy, same room slug, partner status UI).
 * Requires: mqtt.min.js, arcade-mqtt.js, arcade-connect.js (optional), arcade-room-pick.js
 */
(function (global) {
  'use strict';

  function getRoom(gameKey) {
    if (global.ArcadeConnect && global.ArcadeConnect.getRoomId) {
      return global.ArcadeConnect.getRoomId(gameKey);
    }
    if (global.ArcadeRoom && global.ArcadeRoom.getRoomId) {
      return global.ArcadeRoom.getRoomId(gameKey);
    }
    return 'bens_arcade';
  }

  /**
   * opts.gameKey, localId, remoteId, localLabel, remoteLabel
   * opts.brokerInfoEl, connectionInfoEl, uiRoot
   * opts.onConnected(client, room, api)
   * opts.onMessage(topic, message, api)
   * opts.subscribe(fn) — optional custom subscribe(client, room) instead of default +/status
   */
  function setup(opts) {
    var topicPrefix = opts.topicPrefix || opts.gameKey;
    var room = getRoom(opts.gameKey);
    var localId = opts.localId;
    var remoteId = opts.remoteId;
    var partnerHint =
      opts.partnerHint ||
      'Open ' +
        opts.remoteLabel +
        ' with ?room=' +
        room +
        ' on the other seat, then Send ready ping.';

    var state = {
      client: null,
      link: null,
      room: room,
      topicPrefix: topicPrefix,
      localId: localId,
      remoteId: remoteId,
      partnerOk: false,
      partnerTrying: true,
      lastPartnerMsg: 0,
      connectStart: Date.now(),
    };

    function syncPartnerUi() {
      if (!state.link) {
        return;
      }
      if (state.partnerOk) {
        state.link.setPartner('linked');
      } else if (state.partnerTrying) {
        state.link.setPartner('waiting', partnerHint);
      } else {
        state.link.setPartner('none');
      }
    }

    function touchPartner() {
      state.partnerOk = true;
      state.partnerTrying = false;
      state.lastPartnerMsg = Date.now();
      syncPartnerUi();
    }

    function partnerFromTopic(topic) {
      var parts = String(topic || '').split('/');
      if (parts.length >= 3 && parts[2] === remoteId) {
        touchPartner();
        return true;
      }
      return false;
    }

    var api = {
      getClient: function () {
        return state.client;
      },
      getLink: function () {
        return state.link;
      },
      getRoom: function () {
        return room;
      },
      getTopicPrefix: function () {
        return topicPrefix;
      },
      touchPartner: touchPartner,
      setPartner: function (ok, trying) {
        state.partnerOk = !!ok;
        state.partnerTrying = trying !== false;
        syncPartnerUi();
      },
      publish: function (suffix, payload, asId) {
        var who = asId || localId;
        var topic = topicPrefix + '/' + room + '/' + who + '/' + suffix;
        var body = typeof payload === 'string' ? payload : JSON.stringify(payload);
        if (state.client && state.client.connected) {
          state.client.publish(topic, body);
          return true;
        }
        return false;
      },
      publishStatus: function (status) {
        return api.publish('status', status);
      },
      topic: function (playerId, suffix) {
        return topicPrefix + '/' + room + '/' + playerId + '/' + suffix;
      },
    };

    if (!global.ArcadeMqtt) {
      if (opts.connectionInfoEl) {
        opts.connectionInfoEl.innerHTML =
          'MQTT: <span style="color:#ff6b6b">arcade-mqtt.js missing</span>';
      }
      return api;
    }

    state.link = global.ArcadeMqtt.createLink({
      brokerInfoEl: opts.brokerInfoEl,
      connectionInfoEl: opts.connectionInfoEl,
      uiRoot: opts.uiRoot,
      partnerHint: partnerHint,
      mqttOptions: opts.mqttOptions,
      onConnected: function (c) {
        state.client = c;
        if (typeof opts.subscribe === 'function') {
          opts.subscribe(c, room, api);
        } else {
          c.subscribe(topicPrefix + '/' + room + '/+/state');
          c.subscribe(topicPrefix + '/' + room + '/+/status');
          if (opts.extraTopics) {
            opts.extraTopics.forEach(function (t) {
              c.subscribe(t);
            });
          }
        }
        if (opts.onConnected) {
          opts.onConnected(c, room, api);
        }
        state.link.log('ok', 'Subscribed — waiting for ' + opts.remoteLabel);
        syncPartnerUi();
      },
      onClose: function () {
        state.client = null;
        state.partnerOk = false;
        state.partnerTrying = true;
        syncPartnerUi();
        if (opts.onClose) {
          opts.onClose(api);
        }
      },
      onMessage: function (topic, message) {
        partnerFromTopic(topic);
        if (opts.onMessage) {
          opts.onMessage(topic, message, api);
        }
      },
    });

    syncPartnerUi();

    global.setInterval(function () {
      var stale = opts.partnerStaleMs != null ? opts.partnerStaleMs : 8000;
      var giveUp = opts.partnerGiveUpMs != null ? opts.partnerGiveUpMs : 12000;
      var now = Date.now();
      if (state.partnerOk && now - state.lastPartnerMsg > stale) {
        state.partnerOk = false;
        state.partnerTrying = false;
        syncPartnerUi();
      }
      if (state.partnerTrying && now - state.connectStart > giveUp && state.lastPartnerMsg === 0) {
        state.partnerTrying = false;
        syncPartnerUi();
      }
    }, 1000);

    return api;
  }

  global.ArcadeGameMqtt = {
    setup: setup,
    getRoom: getRoom,
  };
})(typeof window !== 'undefined' ? window : this);
