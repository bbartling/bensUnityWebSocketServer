/**
 * Shared MQTT WebSocket connect (with broker fallback) + visible status / log for arcade games.
 * window.ArcadeMqtt.connect(opts) -> client
 * window.ArcadeMqtt.createLink(opts) -> { client, setPartner, render, log }
 */
(function (global) {
  'use strict';

  /** Ordered list — first connect wins. test.mosquitto.org:8081 is often down; HiveMQ is reliable. */
  var BROKER_CANDIDATES = [
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/mqtt',
    'wss://test.mosquitto.org:8080/mqtt',
  ];

  var activeBroker = BROKER_CANDIDATES[0];
  var LOG_MAX = 40;

  function pushLog(state, level, msg) {
    if (!state.log) {
      state.log = [];
    }
    state.log.push({
      t: new Date().toLocaleTimeString(),
      level: level,
      msg: String(msg),
    });
    if (state.log.length > LOG_MAX) {
      state.log.shift();
    }
  }

  function defaultConnectOptions() {
    return {
      reconnectPeriod: 5000,
      connectTimeout: 15000,
      keepalive: 30,
      clean: true,
      protocolVersion: 4,
    };
  }

  /**
   * Try each broker until one connects. Calls opts.onConnected(client, brokerUrl) once.
   * opts.onBrokerStatus({ brokerUrl, brokerState, attempt, total, lastError, log })
   */
  function connect(opts) {
    if (!global.mqtt) {
      var errMsg = 'mqtt.min.js not loaded';
      if (opts.onBrokerStatus) {
        opts.onBrokerStatus({
          brokerUrl: '—',
          brokerState: 'failed',
          attempt: 0,
          total: BROKER_CANDIDATES.length,
          lastError: errMsg,
          log: [{ t: '', level: 'error', msg: errMsg }],
        });
      }
      if (opts.onError) {
        opts.onError(new Error(errMsg));
      }
      return null;
    }

    var state = {
      brokerUrl: BROKER_CANDIDATES[0],
      brokerState: 'connecting',
      attempt: 0,
      total: BROKER_CANDIDATES.length,
      lastError: '',
      log: [],
    };
    var client = null;
    var connected = false;
    var tryIdx = 0;

    function emitStatus() {
      if (opts.onBrokerStatus) {
        opts.onBrokerStatus({
          brokerUrl: state.brokerUrl,
          brokerState: state.brokerState,
          attempt: state.attempt,
          total: state.total,
          lastError: state.lastError,
          log: state.log.slice(),
        });
      }
    }

    function tryNext() {
      if (connected || tryIdx >= BROKER_CANDIDATES.length) {
        if (!connected) {
          state.brokerState = 'failed';
          pushLog(state, 'error', 'All brokers failed. Check network / firewall for WSS.');
          emitStatus();
          if (opts.onError) {
            opts.onError(new Error(state.lastError || 'MQTT connect failed'));
          }
        }
        return;
      }
      if (client) {
        try {
          client.end(true);
        } catch (e) {
          /* ignore */
        }
        client = null;
      }
      state.attempt = tryIdx + 1;
      state.brokerUrl = BROKER_CANDIDATES[tryIdx];
      state.brokerState = 'connecting';
      pushLog(state, 'info', 'Connecting to ' + state.brokerUrl + '…');
      emitStatus();

      var url = BROKER_CANDIDATES[tryIdx];
      var c = global.mqtt.connect(url, Object.assign({}, defaultConnectOptions(), opts.mqttOptions || {}));

      function failNext(errText) {
        state.lastError = errText || 'connect failed';
        pushLog(state, 'warn', state.brokerUrl + ': ' + state.lastError);
        emitStatus();
        tryIdx++;
        global.setTimeout(tryNext, 400);
      }

      c.on('connect', function () {
        if (connected) {
          return;
        }
        connected = true;
        activeBroker = url;
        client = c;
        state.brokerState = 'connected';
        state.lastError = '';
        pushLog(state, 'ok', 'Connected to ' + url);
        emitStatus();
        if (opts.onConnected) {
          opts.onConnected(c, url);
        }
      });
      c.on('error', function (err) {
        if (connected) {
          pushLog(state, 'warn', 'MQTT error: ' + (err && err.message ? err.message : String(err)));
          emitStatus();
          return;
        }
        failNext(err && err.message ? err.message : String(err));
      });
      c.on('close', function () {
        if (connected) {
          state.brokerState = 'offline';
          pushLog(state, 'warn', 'Disconnected from broker');
          emitStatus();
          if (opts.onClose) {
            opts.onClose();
          }
        }
      });
      c.on('reconnect', function () {
        state.brokerState = 'connecting';
        pushLog(state, 'info', 'Reconnecting…');
        emitStatus();
        if (opts.onReconnect) {
          opts.onReconnect();
        }
      });
      c.on('offline', function () {
        state.brokerState = 'offline';
        emitStatus();
        if (opts.onOffline) {
          opts.onOffline();
        }
      });
      c.on('message', function (topic, message) {
        if (opts.onMessage) {
          opts.onMessage(topic, message);
        }
      });

      global.setTimeout(function () {
        if (!connected && c === client) {
          failNext('timeout (15s)');
        }
      }, 15500);

      tryIdx++;
    }

    tryNext();
    return {
      getClient: function () {
        return client;
      },
      getState: function () {
        return state;
      },
    };
  }

  function brokerStateLabel(st) {
    if (st === 'connected') {
      return { text: 'BROKER OK', color: '#7dffb3' };
    }
    if (st === 'connecting') {
      return { text: 'CONNECTING…', color: '#ffe08a' };
    }
    if (st === 'failed') {
      return { text: 'BROKER FAILED', color: '#ff6b6b' };
    }
    return { text: 'OFFLINE', color: '#ff6b6b' };
  }

  function partnerStateLabel(partner) {
    if (partner === 'linked') {
      return { text: 'PARTNER LINKED', color: '#7dffb3' };
    }
    if (partner === 'waiting') {
      return { text: 'WAITING FOR PARTNER', color: '#ffe08a' };
    }
    return { text: 'NO PARTNER', color: '#ff6b6b' };
  }

  /**
   * UI helper for game pages: broker line, connection line, optional log panel.
   */
  function createLink(uiOpts) {
    var brokerInfoEl = uiOpts.brokerInfoEl;
    var connectionInfoEl = uiOpts.connectionInfoEl;
    var uiRoot = uiOpts.uiRoot || (connectionInfoEl && connectionInfoEl.parentElement);
    var partner = 'waiting';
    var partnerHint = uiOpts.partnerHint || 'Open the other seat in the same room.';

    var logWrap = null;
    var logList = null;
    if (uiOpts.showLog !== false && uiRoot) {
      logWrap = global.document.createElement('div');
      logWrap.className = 'arcade-mqtt-log';
      logWrap.innerHTML =
        '<div class="arcade-mqtt-log-title">MQTT log</div>' +
        '<ul class="arcade-mqtt-log-list"></ul>';
      logList = logWrap.querySelector('.arcade-mqtt-log-list');
      if (connectionInfoEl && connectionInfoEl.nextSibling) {
        uiRoot.insertBefore(logWrap, connectionInfoEl.nextSibling);
      } else {
        uiRoot.appendChild(logWrap);
      }
    }

    function renderBrokerStatus(st) {
      if (brokerInfoEl) {
        var extra = st.brokerState === 'connecting' && st.total > 1 ? ' (try ' + st.attempt + '/' + st.total + ')' : '';
        brokerInfoEl.innerHTML =
          'MQTT: <span class="highlight">' +
          (st.brokerUrl || '—') +
          '</span>' +
          (st.lastError && st.brokerState !== 'connected'
            ? ' · <span style="color:#ff9ec8">' + st.lastError + '</span>'
            : '') +
          extra;
      }
      if (connectionInfoEl) {
        var b = brokerStateLabel(st.brokerState);
        var p = partnerStateLabel(partner);
        connectionInfoEl.innerHTML =
          'MQTT: <span style="color:' +
          b.color +
          '">' +
          b.text +
          '</span> · PARTNER: <span style="color:' +
          p.color +
          '">' +
          p.text +
          '</span>' +
          (partner === 'waiting' ? '<br><span class="arcade-mqtt-hint">' + partnerHint + '</span>' : '');
      }
      if (logList && st.log && st.log.length) {
        logList.innerHTML = '';
        st.log.slice(-12).forEach(function (entry) {
          var li = global.document.createElement('li');
          li.className = 'arcade-mqtt-log-' + entry.level;
          li.textContent = (entry.t ? entry.t + ' ' : '') + entry.msg;
          logList.appendChild(li);
        });
      }
    }

    var handle = connect({
      mqttOptions: uiOpts.mqttOptions,
      onBrokerStatus: renderBrokerStatus,
      onConnected: uiOpts.onConnected,
      onMessage: uiOpts.onMessage,
      onClose: uiOpts.onClose,
      onReconnect: uiOpts.onReconnect,
      onOffline: uiOpts.onOffline,
      onError: uiOpts.onError,
    });

    renderBrokerStatus({
      brokerUrl: BROKER_CANDIDATES[0],
      brokerState: 'connecting',
      attempt: 1,
      total: BROKER_CANDIDATES.length,
      lastError: '',
      log: [{ t: '', level: 'info', msg: 'Starting MQTT…' }],
    });

    return {
      getClient: function () {
        return handle && handle.getClient();
      },
      setPartner: function (p, hint) {
        partner = p || 'waiting';
        if (hint) {
          partnerHint = hint;
        }
        if (handle) {
          renderBrokerStatus(handle.getState());
        }
      },
      log: function (level, msg) {
        if (handle) {
          var st = handle.getState();
          pushLog(st, level, msg);
          renderBrokerStatus(st);
        }
      },
      render: renderBrokerStatus,
    };
  }

  global.ArcadeMqtt = {
    BROKER_CANDIDATES: BROKER_CANDIDATES,
    getActiveBroker: function () {
      return activeBroker;
    },
    connect: connect,
    createLink: createLink,
  };
})(typeof window !== 'undefined' ? window : this);
