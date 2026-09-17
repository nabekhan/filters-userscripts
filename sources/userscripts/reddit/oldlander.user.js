// ==UserScript==
// @name         OldLander Remote Loaded
// @namespace    https://github.com/OctoNezd/oldlander
// @homepageURL  https://github.com/OctoNezd/oldlander
// @downloadURL  https://raw.githubusercontent.com/nabekhan/filters-userscripts/main/sources/userscripts/reddit/oldlander.user.js
// @updateURL    https://raw.githubusercontent.com/nabekhan/filters-userscripts/main/sources/userscripts/reddit/oldlander.user.js
// @version      1.2.0.531
// @description  Makes old reddit more usable on mobile devices.
// @author       OctoNezd
// @match        https://reddit.com/*
// @match        https://old.reddit.com/*
// @match        https://*.reddit.com/*
// @icon         https://raw.githubusercontent.com/OctoNezd/oldlander/main/icons/icon.png
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.xmlHttpRequest
// @inject-into  content
// @run-at       document-start
// @weight       998
// ==/UserScript==

(async function () {
  'use strict';

  const SOURCE_URL =
    'https://github.com/OctoNezd/oldlander/releases/latest/download/oldlander.user.js';
  const CACHE_NAME = 'oldlander-async-loader-v1';
  const CACHE_KEY = SOURCE_URL + '?userscripts-async-cache=1';
  const REFRESH_INTERVAL = 24 * 60 * 60 * 1000;
  const BACKGROUND_KEY = 'oldlander-flash-background-v1';
  const ADGUARD_BACKGROUND_PROPERTY = '--oldlander-adguard-background';
  const root = document.documentElement;

  let readyObserver = null;
  let themeObserver = null;
  let settleTimer = null;

  root.setAttribute('data-oldlander-loader-state', 'loading');

  function renderedBackground() {
    if (!document.body || !document.body.classList.contains('background')) {
      return null;
    }

    const background = getComputedStyle(document.body).backgroundColor;
    return background === 'transparent' || background === 'rgba(0, 0, 0, 0)'
      ? null
      : background;
  }

  function saveBackground(background) {
    if (!background || !CSS.supports('color', background)) {
      return;
    }

    try {
      localStorage.setItem(BACKGROUND_KEY, background);
    } catch (error) {
      // Storage can be unavailable in private browsing.
    }
  }

  function watchThemeChanges() {
    if (!document.body || themeObserver) {
      return;
    }

    themeObserver = new MutationObserver(function () {
      window.setTimeout(function () {
        saveBackground(renderedBackground());
      }, 50);
    });
    themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  function finishAdGuardHandoff() {
    if (
      !root.classList.contains('oldlander') ||
      !document.body ||
      !document.body.classList.contains('background')
    ) {
      return;
    }

    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(function () {
      saveBackground(renderedBackground());
      root.style.removeProperty(ADGUARD_BACKGROUND_PROPERTY);
      root.style.removeProperty('background');
      if (readyObserver) {
        readyObserver.disconnect();
        readyObserver = null;
      }
      watchThemeChanges();
    }, 50);
  }

  function revealStockRedditAfterFailure() {
    root.style.removeProperty(ADGUARD_BACKGROUND_PROPERTY);
    root.style.removeProperty('background');

    function revealBody() {
      if (document.body) {
        // This also releases the AdGuard body:not(.background) rule.
        document.body.classList.add('background');
      }
    }

    revealBody();
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', revealBody, { once: true });
    }
  }

  readyObserver = new MutationObserver(finishAdGuardHandoff);
  readyObserver.observe(root, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    subtree: true,
  });

  function validSource(source) {
    return (
      typeof source === 'string' &&
      source.length > 1000000 &&
      source.slice(0, 2000).includes('@name         OldLander')
    );
  }

  async function fetchSource() {
    const response = await GM.xmlHttpRequest({
      method: 'GET',
      url: SOURCE_URL,
      responseType: 'text',
      timeout: 30000,
    });
    const source = response.responseText || response.response;

    if (
      response.status < 200 ||
      response.status >= 300 ||
      !validSource(source)
    ) {
      throw new Error(
        'OldLander download failed with status ' + response.status,
      );
    }

    return source;
  }

  async function cacheSource(cache, source) {
    await cache.put(
      CACHE_KEY,
      new Response(source, {
        headers: {
          'Content-Type': 'text/javascript; charset=utf-8',
          'X-OldLander-Cached-At': String(Date.now()),
        },
      }),
    );
  }

  async function refreshSource(cache) {
    const source = await fetchSource();
    await cacheSource(cache, source);
    return source;
  }

  async function loadSource() {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(CACHE_KEY);

    if (!cachedResponse) {
      return refreshSource(cache);
    }

    const source = await cachedResponse.text();
    if (!validSource(source)) {
      await cache.delete(CACHE_KEY);
      return refreshSource(cache);
    }

    const cachedAt =
      Number(cachedResponse.headers.get('X-OldLander-Cached-At')) || 0;
    if (Date.now() - cachedAt > REFRESH_INTERVAL) {
      refreshSource(cache).catch(function (error) {
        console.warn('OldLander background refresh failed', error);
      });
    }

    return source;
  }

  try {
    const source = await loadSource();
    Function('GM', source + '\n//# sourceURL=oldlander.cached.user.js')(GM);
    root.setAttribute('data-oldlander-loader-state', 'ready');
    finishAdGuardHandoff();
  } catch (error) {
    root.setAttribute('data-oldlander-loader-state', 'error');
    if (readyObserver) {
      readyObserver.disconnect();
      readyObserver = null;
    }
    revealStockRedditAfterFailure();
    console.error('Unable to load OldLander', error);
  }
})();
