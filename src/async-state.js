(function attachDeskpriteAsyncState(root, factory) {
  const asyncState = factory();
  if (typeof module === 'object' && module.exports) module.exports = asyncState;
  else root.DeskpriteAsyncState = asyncState;
}(typeof globalThis === 'undefined' ? this : globalThis, () => {
  'use strict';

  function createLatestOperationGuard() {
    let version = 0;

    return Object.freeze({
      begin() {
        version += 1;
        return version;
      },
      invalidate() {
        version += 1;
        return version;
      },
      isCurrent(operation) {
        return operation === version;
      },
      commit(operation, callback) {
        if (operation !== version) return false;
        callback();
        return true;
      },
    });
  }

  return Object.freeze({ createLatestOperationGuard });
}));
