'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createLatestOperationGuard } = require('../src/async-state');
const {
  ERROR_MESSAGES,
  PET_BEHAVIOR_DEFAULTS,
  normalizePetBehavior,
  preferredAreaBounds,
  wanderDelayForBehavior,
  wanderDistanceRange,
} = require('../src/core');
const { cleanPetUpdates, mergePetBehavior } = require('../src/pet-settings');
const { createPetVisibilityState } = require('../src/pet-visibility');
const { installReadyToShowGate } = require('../src/window-lifecycle');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

class FakeWindow extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.showCount = 0;
  }

  isDestroyed() {
    return this.destroyed;
  }

  showInactive() {
    this.showCount += 1;
  }
}

function messageOf(callback) {
  assert.throws(callback, (error) => {
    assert.equal(error.message, ERROR_MESSAGES.generic);
    return true;
  });
}

test('a buddy window appears only after its delayed ready event', () => {
  const window = new FakeWindow();
  installReadyToShowGate(window, () => true);

  assert.equal(window.showCount, 0);
  window.emit('ready-to-show');
  assert.equal(window.showCount, 1);
  window.emit('ready-to-show');
  assert.equal(window.showCount, 1, 'the one-time ready handler must not show twice');
});

test('hiding a buddy while its window loads prevents the late ready event from showing it', () => {
  const window = new FakeWindow();
  let shown = true;
  installReadyToShowGate(window, () => shown);

  shown = false;
  window.emit('ready-to-show');

  assert.equal(window.showCount, 0);
});

test('a destroyed buddy window is never shown when delayed loading finishes', () => {
  const window = new FakeWindow();
  installReadyToShowGate(window, () => true);

  window.destroyed = true;
  window.emit('ready-to-show');

  assert.equal(window.showCount, 0);
});

test('a hide request made before window registration blocks the eventual ready event', () => {
  const visibility = createPetVisibilityState();
  const window = new FakeWindow();

  visibility.begin('pet-sprout', false);
  installReadyToShowGate(window, () => visibility.get('pet-sprout', true));
  window.emit('ready-to-show');

  assert.equal(visibility.get('pet-sprout', true), false);
  assert.equal(window.showCount, 0);
  assert.equal(visibility.get('pet-mochi', true), true);
  assert.equal(visibility.delete('pet-sprout'), true);
  assert.equal(visibility.get('pet-sprout', true), true);
});

test('a bulk hide also covers a buddy added after the initial store snapshot', () => {
  const visibility = createPetVisibilityState();
  const operations = visibility.beginMany(['pet-sprout'], false);

  visibility.beginMany(['pet-sprout', 'pet-new'], false, operations);
  const lateWindow = new FakeWindow();
  installReadyToShowGate(lateWindow, () => visibility.get('pet-new', true));
  lateWindow.emit('ready-to-show');

  assert.equal(operations.size, 2);
  assert.equal(visibility.get('pet-new', true), false);
  assert.equal(lateWindow.showCount, 0);
});

test('visibility rollback cannot overwrite a newer overlapping request', () => {
  const visibility = createPetVisibilityState();
  const hide = visibility.begin('pet-sprout', false);
  const show = visibility.begin('pet-sprout', true);

  assert.equal(visibility.rollback(hide), false, 'the stale hide must not replace the newer show');
  assert.equal(visibility.get('pet-sprout', false), true);
  assert.equal(visibility.rollback(show), true);
  assert.equal(
    visibility.get('pet-sprout', true),
    true,
    'rolling back both failed writes must reach the original fallback state',
  );
  assert.equal(visibility.rollback(hide), false, 'a settled rollback cannot be replayed later');
});

test('rolling back only the latest visibility request restores the prior desired state', () => {
  const visibility = createPetVisibilityState();
  visibility.begin('pet-sprout', false);
  const show = visibility.begin('pet-sprout', true);

  assert.equal(visibility.rollback(show), true);
  assert.equal(visibility.get('pet-sprout', true), false);
});

test('only the newest sprite import may publish results when reads finish out of order', async () => {
  const guard = createLatestOperationGuard();
  const firstRead = deferred();
  const secondRead = deferred();
  const published = [];

  async function importSprite(readTask, name) {
    const operation = guard.begin();
    const frames = await readTask.promise;
    return guard.commit(operation, () => published.push({ name, frames }));
  }

  const firstImport = importSprite(firstRead, 'first.png');
  const secondImport = importSprite(secondRead, 'second.png');
  secondRead.resolve(['second-idle', 'second-walk']);
  assert.equal(await secondImport, true);
  firstRead.resolve(['first-idle', 'first-walk']);
  assert.equal(await firstImport, false);

  assert.deepEqual(published, [{
    name: 'second.png',
    frames: ['second-idle', 'second-walk'],
  }]);
});

test('clearing an import invalidates work that is still decoding', async () => {
  const guard = createLatestOperationGuard();
  const read = deferred();
  const operation = guard.begin();
  const publish = read.promise.then((frames) => guard.commit(operation, () => frames));

  guard.invalidate();
  read.resolve(['stale-frame']);

  assert.equal(await publish, false);
});

test('saved buddies without behavior settings receive the complete stable defaults', () => {
  assert.deepEqual(normalizePetBehavior(), {
    frequency: 'normal',
    distance: 'normal',
    area: 'anywhere',
    stayOnMonitor: false,
  });
  assert.deepEqual(normalizePetBehavior({}), PET_BEHAVIOR_DEFAULTS);
  assert.deepEqual(normalizePetBehavior({
    frequency: 'invalid',
    distance: null,
    area: 'center',
    stayOnMonitor: 'yes',
  }), PET_BEHAVIOR_DEFAULTS);
});

test('walking frequency, distance, and preferred-area settings change movement deterministically', () => {
  assert.ok(
    wanderDelayForBehavior('rare', false, 0, 0) > wanderDelayForBehavior('normal', false, 0, 0),
  );
  assert.ok(
    wanderDelayForBehavior('normal', false, 0, 0) > wanderDelayForBehavior('often', false, 0, 0),
  );
  assert.deepEqual(wanderDistanceRange('short'), { minimum: 90, spread: 70 });
  assert.deepEqual(wanderDistanceRange('normal'), { minimum: 175, spread: 170 });
  assert.deepEqual(wanderDistanceRange('long'), { minimum: 310, spread: 210 });

  const desktop = { x: -100, y: 20, width: 1001, height: 701 };
  assert.deepEqual(preferredAreaBounds(desktop, 'left'), {
    x: -100, y: 20, width: 501, height: 701,
  });
  assert.deepEqual(preferredAreaBounds(desktop, 'right'), {
    x: 401, y: 20, width: 500, height: 701,
  });
  assert.deepEqual(preferredAreaBounds(desktop, 'top'), {
    x: -100, y: 20, width: 1001, height: 351,
  });
  assert.deepEqual(preferredAreaBounds(desktop, 'bottom'), {
    x: -100, y: 371, width: 1001, height: 350,
  });
});

test('a full saved-setting update keeps every supported behavior field', () => {
  assert.deepEqual(cleanPetUpdates({
    name: '  Fern  ',
    size: '144',
    motion: 'wander',
    behavior: {
      frequency: 'often',
      distance: 'long',
      area: 'right',
      stayOnMonitor: true,
    },
  }), {
    name: 'Fern',
    size: 144,
    motion: 'wander',
    behavior: {
      frequency: 'often',
      distance: 'long',
      area: 'right',
      stayOnMonitor: true,
    },
  });
});

test('partial saved-setting updates preserve their intentional nested shape', () => {
  assert.deepEqual(cleanPetUpdates({
    behavior: { frequency: 'rare' },
  }), {
    behavior: { frequency: 'rare' },
  });
  assert.deepEqual(cleanPetUpdates({
    behavior: { stayOnMonitor: false },
  }), {
    behavior: { stayOnMonitor: false },
  });
  assert.deepEqual(mergePetBehavior({
    frequency: 'often',
    distance: 'long',
    area: 'bottom',
    stayOnMonitor: true,
  }, {
    frequency: 'rare',
    stayOnMonitor: false,
  }), {
    frequency: 'rare',
    distance: 'long',
    area: 'bottom',
    stayOnMonitor: false,
  });
});

test('saved-setting updates reject invalid behavior enums, booleans, and unsupported fields', () => {
  messageOf(() => cleanPetUpdates({ behavior: { frequency: 'constantly' } }));
  messageOf(() => cleanPetUpdates({ behavior: { distance: 'huge' } }));
  messageOf(() => cleanPetUpdates({ behavior: { area: 'center' } }));
  messageOf(() => cleanPetUpdates({ behavior: { stayOnMonitor: 1 } }));
  messageOf(() => cleanPetUpdates({ behavior: { speed: 'fast' } }));
  messageOf(() => cleanPetUpdates({ behavior: {} }));
});

test('the production window and importer paths use the tested race guards', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const creatorHtml = fs.readFileSync(path.join(root, 'src', 'creator.html'), 'utf8');
  const creatorScript = fs.readFileSync(path.join(root, 'src', 'creator.js'), 'utf8');

  assert.match(main, /require\('\.\/src\/window-lifecycle'\)/);
  assert.match(main, /require\('\.\/src\/pet-visibility'\)/);
  assert.match(main, /installReadyToShowGate\(window, \(\) => petVisibility\.get\(id, pet\.shown !== false\)\)/);
  assert.ok(
    creatorHtml.indexOf('src="async-state.js"') < creatorHtml.indexOf('src="creator.js"'),
    'the importer guard must load before the creator code',
  );
  assert.match(creatorScript, /const importLoadGuard = createLatestOperationGuard\(\)/);
  assert.match(creatorScript, /const importBuildGuard = createLatestOperationGuard\(\)/);
  assert.match(creatorScript, /importLoadGuard\.isCurrent\(operation\)/);
  assert.match(creatorScript, /importBuildGuard\.isCurrent\(operation\)/);
});
