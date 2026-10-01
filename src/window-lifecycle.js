'use strict';

function installReadyToShowGate(window, shouldShow) {
  if (!window || typeof window.once !== 'function') {
    throw new TypeError('A window with event support is required.');
  }
  if (typeof shouldShow !== 'function') {
    throw new TypeError('A visibility predicate is required.');
  }

  window.once('ready-to-show', () => {
    if (!window.isDestroyed() && shouldShow(window)) window.showInactive();
  });
}

module.exports = Object.freeze({ installReadyToShowGate });
