// ==UserScript==
// @name         Old Reddit + Media Fixes
// @description  Sends standard pages to old Reddit, preserves modern-only routes, displays comment images, and enables Safari's native video controls.
// @author       littux, Spencer Ayers-Hale; combined and adapted for Safari Userscripts
// @version      2.7.4
// @license      GPL-3.0-only
// @match        *://*.reddit.com/*
// @run-at       document-start
// @grant        none
// @namespace    local.nabeel.old-reddit-combined
// @updateURL    https://raw.githubusercontent.com/nabekhan/filters-userscripts/main/sources/userscripts/reddit/old-reddit.user.js
// @downloadURL  https://raw.githubusercontent.com/nabekhan/filters-userscripts/main/sources/userscripts/reddit/old-reddit.user.js
// ==/UserScript==

/*
 * Combined from:
 * - Default to/Force Old Reddit on www.reddit.com 1.0.1
 *   https://greasyfork.org/scripts/569062
 * - Old Reddit Inline Images 1.51
 *   https://greasyfork.org/scripts/492046
 *
 * Safari Userscripts does not implement the synchronous GM_getValue,
 * GM_setValue, and GM_registerMenuCommand APIs used by script 569062.
 * The upstream cookie approach is adapted here because Reddit still redirects
 * /gallery to an old comments page when redesign_optout=true. This version
 * keeps that cookie cleared, redirects ordinary pages to old.reddit.com, and
 * sends unsupported old-Reddit routes to www.reddit.com on demand.
 */

(function () {
  'use strict';

  const OLD_REDDIT_COOKIE = 'redesign_optout';
  const OLD_REDDIT_HOST = 'old.reddit.com';
  const MODERN_REDDIT_HOST = 'www.reddit.com';
  const MODERN_BYPASS_MARKER = 'old-reddit-modern';
  const REDIRECTABLE_HOSTS = new Set([
    'reddit.com',
    'www.reddit.com',
    'new.reddit.com',
    'np.reddit.com',
    'amp.reddit.com',
    'i.reddit.com',
  ]);
  const MODERN_ONLY_PATHS = [
    /^\/(?:media|gallery|poll)(?:\/|$)/i,
    /^\/(?:settings|topics|community-points|appeals?|notifications|chat|rpan)(?:\/|$)/i,
    /^\/(?:premium|achievements|avatar|vault|collectible-expressions)(?:\/|$)/i,
    /^\/(?:login|register)(?:\/|$)/i,
    /^\/message(?:\/|$)/i,
    /^\/mod(?:\/|$)/i,
    /^\/(?:r\/[^/]+\/)?s\/[^/]+(?:\/|$)/i,
  ];
  const IMAGE_MARKER = 'data-old-reddit-inline-image';
  const VIDEO_PLAYER_SELECTOR = '.reddit-video-player-root';
  const VIDEO_PLAYER_MARKER = 'data-safari-native-player';
  const VIDEO_MARKER = 'data-safari-native-video';
  const NEVER_PIN_VIDEO = 'function(){return false;}';
  const IMAGE_SELECTOR = [
    'a[href*="//i.redd.it/"]',
    'a[href*="//preview.redd.it/"]',
  ].join(',');

  function isModernOnlyPath(pathname) {
    return MODERN_ONLY_PATHS.some(function (pattern) {
      return pattern.test(pathname);
    });
  }

  function clearOldRedditCookie() {
    document.cookie =
      OLD_REDDIT_COOKIE +
      '=; domain=.reddit.com; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; Secure';
  }

  function navigationRedirectCount() {
    if (performance.getEntriesByType) {
      const navigation = performance.getEntriesByType('navigation')[0];
      if (navigation) {
        return navigation.redirectCount;
      }
    }

    return performance.navigation ? performance.navigation.redirectCount : 0;
  }

  function redirectToOldReddit(url) {
    url.hostname = OLD_REDDIT_HOST;
    location.replace(url.href);
  }

  function redirectOldRedditHomeToTop() {
    if (location.hostname === OLD_REDDIT_HOST && location.pathname === '/') {
      location.replace(
        'https://' + OLD_REDDIT_HOST + '/r/all/top/?sort=top&t=day',
      );
      return true;
    }

    return false;
  }

  function hasModernBypassMarker(url) {
    return (
      url.hash === '#' + MODERN_BYPASS_MARKER ||
      url.hash.indexOf('#' + MODERN_BYPASS_MARKER + ':') === 0
    );
  }

  function addModernBypassMarker(url) {
    const previousHash = url.hash.slice(1);
    url.hash =
      '#' +
      MODERN_BYPASS_MARKER +
      (previousHash ? ':' + encodeURIComponent(previousHash) : '');
  }

  function removeModernBypassMarker(url) {
    const prefix = '#' + MODERN_BYPASS_MARKER + ':';
    if (url.hash.indexOf(prefix) === 0) {
      url.hash = decodeURIComponent(url.hash.slice(prefix.length));
    } else {
      url.hash = '';
    }

    history.replaceState(
      history.state,
      document.title,
      url.pathname + url.search + url.hash,
    );
  }

  function inspectRedirectedPost(url) {
    let decided = false;
    let observer = null;

    function finish(keepModern) {
      if (decided) {
        return;
      }

      decided = true;
      if (observer) {
        observer.disconnect();
      }

      if (!keepModern) {
        redirectToOldReddit(url);
      }
    }

    function inspect(root) {
      let post = null;
      if (
        root.nodeType === Node.ELEMENT_NODE &&
        root.matches('shreddit-post')
      ) {
        post = root;
      } else if (root.querySelector) {
        post = root.querySelector('shreddit-post');
      }

      if (!post) {
        return false;
      }

      const postType = post.getAttribute('post-type');
      finish(postType === 'gallery' || postType === 'poll');
      return true;
    }

    // A stale redesign_optout cookie can make www.reddit.com return the
    // classic document once. Do not wait for a Shreddit element that will
    // never appear in that case.
    if (
      document.documentElement &&
      document.documentElement.hasAttribute('xmlns')
    ) {
      finish(false);
      return;
    }

    if (inspect(document)) {
      return;
    }

    observer = new MutationObserver(function (mutations) {
      for (
        let mutationIndex = 0;
        mutationIndex < mutations.length;
        mutationIndex++
      ) {
        const addedNodes = mutations[mutationIndex].addedNodes;
        for (let nodeIndex = 0; nodeIndex < addedNodes.length; nodeIndex++) {
          const node = addedNodes[nodeIndex];
          if (node.nodeType === Node.ELEMENT_NODE && inspect(node)) {
            return;
          }
        }
      }
    });
    observer.observe(document, { childList: true, subtree: true });

    // Fallback for unexpected markup. Normal posts are decided as soon as
    // their server-rendered shreddit-post element is parsed.
    window.addEventListener(
      'DOMContentLoaded',
      function () {
        if (!inspect(document)) {
          finish(false);
        }
      },
      { once: true },
    );
  }

  function redirectOrdinaryPageToOldReddit() {
    if (!REDIRECTABLE_HOSTS.has(location.hostname)) {
      return;
    }

    const url = new URL(location.href);

    // A marker added before navigation survives Reddit's /gallery or
    // /poll canonicalization to /comments, allowing an immediate decision.
    if (hasModernBypassMarker(url)) {
      removeModernBypassMarker(url);
      return;
    }

    if (isModernOnlyPath(url.pathname)) {
      return;
    }

    // Reddit canonicalizes /gallery and /poll URLs to /comments before a
    // userscript can run. For direct/pasted URLs without a marker, inspect
    // only until the server-rendered post element is parsed.
    if (
      /^\/(?:r\/[^/]+\/)?comments\/[a-z0-9]+(?:\/|$)/i.test(url.pathname) &&
      navigationRedirectCount() > 0
    ) {
      inspectRedirectedPost(url);
      return;
    }

    redirectToOldReddit(url);
  }

  function pointModernOnlyLinkAtModernReddit(event) {
    if (!(event.target instanceof Element)) {
      return;
    }

    const link = event.target.closest('a[href]');
    if (!link) {
      return;
    }

    let url;
    try {
      url = new URL(link.href);
    } catch (error) {
      return;
    }

    // A bare v.redd.it URL redirects through www.reddit.com/video before
    // resolving the post. Old Reddit already exposes the post permalink on
    // its surrounding .thing, so use it directly and avoid that round trip.
    if (url.hostname === 'v.redd.it') {
      const post = link.closest('.thing[data-permalink]');
      const permalink = post && post.getAttribute('data-permalink');
      if (permalink) {
        link.href = new URL(permalink, 'https://' + OLD_REDDIT_HOST).href;
      }
      return;
    }

    if (
      (url.hostname === OLD_REDDIT_HOST ||
        REDIRECTABLE_HOSTS.has(url.hostname)) &&
      isModernOnlyPath(url.pathname)
    ) {
      url.protocol = 'https:';
      url.hostname = MODERN_REDDIT_HOST;

      // Modern Reddit canonicalizes /gallery/<id> to the post permalink.
      // Preserve its lightbox hash through that redirect so clicking an
      // old-Reddit gallery thumbnail opens the gallery viewer immediately.
      if (
        /^\/gallery\/[a-z0-9]+(?:\/|$)/i.test(url.pathname) &&
        link.closest('.thing[data-is-gallery="true"]')
      ) {
        url.hash = '#lightbox';
      }

      if (!hasModernBypassMarker(url)) {
        addModernBypassMarker(url);
      }
      link.href = url.href;
    }
  }

  function installStyles() {
    if (document.getElementById('old-reddit-inline-image-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'old-reddit-inline-image-styles';
    style.textContent = [
      '.old-reddit-inline-image-link {',
      '  display: block;',
      '  width: fit-content;',
      '  max-width: 100%;',
      '  margin: 6px 0 2px;',
      '}',
      '.old-reddit-inline-image {',
      '  display: block;',
      '  width: auto;',
      '  height: auto;',
      '  border: 0;',
      '  cursor: zoom-in;',
      '}',
      '.old-reddit-inline-image--comment {',
      '  max-width: min(100%, 320px);',
      '  max-height: 320px;',
      '}',
      '.old-reddit-inline-image--post {',
      '  max-width: min(100%, 840px);',
      '  max-height: 75vh;',
      '}',
      VIDEO_PLAYER_SELECTOR + '[' + VIDEO_PLAYER_MARKER + '] > div {',
      '  display: none !important;',
      '}',
      VIDEO_PLAYER_SELECTOR + '[' + VIDEO_PLAYER_MARKER + '] {',
      '  height: auto !important;',
      '  min-height: 0 !important;',
      '  max-height: none !important;',
      '  padding: 0 !important;',
      '}',
      VIDEO_PLAYER_SELECTOR + '[' + VIDEO_PLAYER_MARKER + ']::after {',
      '  display: none !important;',
      '  content: none !important;',
      '  padding: 0 !important;',
      '}',
      VIDEO_PLAYER_SELECTOR +
        '[' +
        VIDEO_PLAYER_MARKER +
        '] > video[' +
        VIDEO_MARKER +
        '] {',
      '  display: block !important;',
      '  width: 100% !important;',
      '  height: auto !important;',
      '  max-width: 100% !important;',
      '  max-height: min(75vh, 486px) !important;',
      '  margin: 0 auto !important;',
      '  object-fit: contain !important;',
      '  pointer-events: auto !important;',
      '  position: relative !important;',
      '  top: auto !important;',
      '  right: auto !important;',
      '  bottom: auto !important;',
      '  left: auto !important;',
      '  transform: none !important;',
      '  z-index: 1 !important;',
      '}',
    ].join('\n');
    document.head.appendChild(style);
  }

  function directImageUrl(href) {
    let url;

    try {
      url = new URL(href);
    } catch (error) {
      return null;
    }

    if (url.hostname !== 'i.redd.it' && url.hostname !== 'preview.redd.it') {
      return null;
    }

    if (url.hostname === 'preview.redd.it') {
      url.hostname = 'i.redd.it';
      url.search = '';
    }

    return url.href;
  }

  function embedImage(link) {
    if (link.hasAttribute(IMAGE_MARKER)) {
      return;
    }

    const originalLabel = link.textContent.trim();
    const isCommentImage = /^(?:<image>|\[image\]|image)$/i.test(originalLabel);
    const isBareImageLink =
      originalLabel === link.href ||
      originalLabel === link.getAttribute('href');

    if (!isCommentImage && !isBareImageLink) {
      return;
    }

    const imageUrl = directImageUrl(link.href);
    if (!imageUrl) {
      return;
    }

    link.setAttribute(IMAGE_MARKER, 'true');
    link.classList.add('old-reddit-inline-image-link');
    link.href = imageUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    const image = document.createElement('img');
    image.className =
      'old-reddit-inline-image ' +
      (isCommentImage
        ? 'old-reddit-inline-image--comment'
        : 'old-reddit-inline-image--post');
    image.src = imageUrl;
    image.alt = isCommentImage ? 'Embedded Reddit image' : originalLabel;
    image.loading = 'lazy';
    image.decoding = 'async';

    image.addEventListener(
      'error',
      function () {
        link.classList.remove('old-reddit-inline-image-link');
        link.replaceChildren(
          document.createTextNode(originalLabel || imageUrl),
        );
      },
      { once: true },
    );

    link.replaceChildren(image);
  }

  function restoreNativeVideoControls(video) {
    if (!video.controls) {
      video.controls = true;
    }

    video.removeAttribute('disablepictureinpicture');
    if ('disablePictureInPicture' in video && video.disablePictureInPicture) {
      video.disablePictureInPicture = false;
    }
  }

  function enhanceVideoPlayer(player) {
    if (player.hasAttribute(VIDEO_PLAYER_MARKER)) {
      return;
    }

    // The direct child is the real HLS video. Reddit also creates a muted
    // seek-preview video deeper in its custom controls; leave that one alone.
    let video = null;
    for (let index = 0; index < player.children.length; index++) {
      if (player.children[index] instanceof HTMLVideoElement) {
        video = player.children[index];
        break;
      }
    }

    if (!video) {
      return;
    }

    player.setAttribute(VIDEO_PLAYER_MARKER, 'true');
    player.setAttribute('data-pin-condition', NEVER_PIN_VIDEO);

    // Reddit caches data-* values through jQuery. Update that cache as well
    // so scrolling never turns the inline player into its corner popup.
    const redditJQuery = window.jQuery || window.$;
    if (redditJQuery) {
      redditJQuery(player).data('pin-condition', NEVER_PIN_VIDEO);
    }

    const pinnableContent = player.closest('.pinnable-content');
    if (pinnableContent) {
      pinnableContent.classList.remove('pinned');
    }
    player.style.removeProperty('width');
    player.style.removeProperty('height');

    video.setAttribute(VIDEO_MARKER, 'true');
    restoreNativeVideoControls(video);

    // Keep Reddit from intercepting Safari presentation-mode changes.
    video.addEventListener(
      'webkitpresentationmodechanged',
      function (event) {
        event.stopPropagation();
      },
      true,
    );
  }

  function processRoot(root) {
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(IMAGE_SELECTOR)) {
      embedImage(root);
    }

    if (
      root.nodeType === Node.ELEMENT_NODE &&
      root.matches(VIDEO_PLAYER_SELECTOR)
    ) {
      enhanceVideoPlayer(root);
    }

    if (!root.querySelectorAll) {
      return;
    }

    const links = root.querySelectorAll(IMAGE_SELECTOR);
    for (let index = 0; index < links.length; index++) {
      embedImage(links[index]);
    }

    const videoPlayers = root.querySelectorAll(VIDEO_PLAYER_SELECTOR);
    for (let index = 0; index < videoPlayers.length; index++) {
      enhanceVideoPlayer(videoPlayers[index]);
    }
  }

  function startInlineImages() {
    installStyles();
    processRoot(document);

    // Inspect only newly inserted subtrees, such as "load more comments"
    // results. The script never rescans the entire page after a mutation.
    const observer = new MutationObserver(function (mutations) {
      for (
        let mutationIndex = 0;
        mutationIndex < mutations.length;
        mutationIndex++
      ) {
        const mutation = mutations[mutationIndex];
        if (mutation.type === 'attributes') {
          restoreNativeVideoControls(mutation.target);
          continue;
        }

        const addedNodes = mutation.addedNodes;
        for (let nodeIndex = 0; nodeIndex < addedNodes.length; nodeIndex++) {
          const node = addedNodes[nodeIndex];
          if (node.nodeType === Node.ELEMENT_NODE) {
            processRoot(node);
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['controls', 'disablepictureinpicture'],
    });
  }

  clearOldRedditCookie();
  if (redirectOldRedditHomeToTop()) {
    return;
  }
  redirectOrdinaryPageToOldReddit();

  // Event delegation covers existing and dynamically loaded links without a
  // link-scanning MutationObserver. pointerdown handles normal, modified,
  // and middle clicks; click covers keyboard activation.
  document.addEventListener(
    'pointerdown',
    pointModernOnlyLinkAtModernReddit,
    true,
  );
  document.addEventListener('click', pointModernOnlyLinkAtModernReddit, true);
  document.addEventListener(
    'contextmenu',
    pointModernOnlyLinkAtModernReddit,
    true,
  );

  function startInlineImagesOnClassicReddit() {
    if (
      location.hostname === OLD_REDDIT_HOST ||
      document.documentElement.hasAttribute('xmlns')
    ) {
      startInlineImages();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      startInlineImagesOnClassicReddit,
      { once: true },
    );
  } else {
    startInlineImagesOnClassicReddit();
  }
})();
