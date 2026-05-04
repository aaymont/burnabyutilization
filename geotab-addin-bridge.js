/**
 * MyGeotab injects the session API by calling geotab.addin[...].initialize(api, state, callback).
 * ES modules run too late for discovery unless this classic script runs first and registers the add-in.
 * The real api is stored on window for the module app (geotab-api.js) to pick up.
 */
(function () {
  function makeAddinLifecycle() {
    return {
      initialize: function (api, state, callback) {
        window.__MYGEOTAB_API__ = api;
        window.__MYGEOTAB_ADDIN_STATE__ = state;
        try {
          window.dispatchEvent(
            new CustomEvent("mygeotab:api-ready", { detail: { api: api, state: state } })
          );
        } catch (e) {
          /* ignore */
        }
        if (typeof callback === "function") {
          callback();
        }
      },
      focus: function (api, state) {
        if (api) {
          window.__MYGEOTAB_API__ = api;
        }
        try {
          window.dispatchEvent(
            new CustomEvent("mygeotab:addin-focus", { detail: { api: api, state: state } })
          );
        } catch (e2) {
          /* ignore */
        }
      },
      blur: function () {}
    };
  }

  window.geotab = window.geotab || {};
  geotab.addin = geotab.addin || {};

  /*
   * Match the ActivityLink HTML filename stem (Geotab convention):
   * e.g. fleet-stats.html → geotab.addin["fleet-stats"]. This entry is index.html → "index".
   */
  geotab.addin["index"] = function () {
    return makeAddinLifecycle();
  };
})();
