/**
 * Local ZOHO.CREATOR.API shim — talks to FastAPI /api/creator/* (Postgres).
 * Drop-in replacement for widgetsdk-min.js when running local_qts.
 */
(function (global) {
  'use strict';

  var API_BASE = (global.QTS_LOCAL_API || '') + '/api/creator';

  function post(path, body) {
    return fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (resp) {
      return resp.json().then(function (data) {
        if (!resp.ok) {
          var msg = (data && (data.detail || data.error || data.message)) || resp.statusText;
          throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
        }
        return data;
      });
    });
  }

  var API = {
    init: function () {
      return post('/init', {}).then(function () { return true; });
    },
    getAllRecords: function (config) {
      return post('/getAllRecords', config || {});
    },
    getRecordById: function (config) {
      return post('/getRecordById', config || {});
    },
    addRecord: function (config) {
      return post('/addRecord', config || {});
    },
    updateRecord: function (config) {
      return post('/updateRecord', config || {});
    },
    deleteRecord: function (config) {
      return post('/deleteRecord', config || {});
    },
  };

  global.ZOHO = {
    CREATOR: {
      init: function () { return API.init(); },
      API: API,
    },
  };
})(typeof window !== 'undefined' ? window : this);
