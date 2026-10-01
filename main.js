const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, session, Tray } = require('electron');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const {
  MAX_IMAGE_PIXELS,
  MAX_FRAMES_PER_CLIP,
  ERROR_MESSAGES,
  clamp,
  normalizePetBehavior,
  normalizePetSize,
  nearestVisiblePositionInAreas,
  petWindowMetrics,
  preferredAreaBounds,
  wanderDistanceRange,
  decodePngDataUrl,
  validatePngHeader,
  validatePixelInfo,
  validateAnimationFrameCounts,
  validateAnimationByteSize,
  wrappedPosition: wrapPositionInArea,
  friendlyErrorMessage,
} = require('./src/core');
const { cleanPetName, cleanPetUpdates, mergePetBehavior } = require('./src/pet-settings');
const { createPetVisibilityState } = require('./src/pet-visibility');
const { installReadyToShowGate } = require('./src/window-lifecycle');

const MAX_PETS = 30;
const PET_ID = /^pet-[a-f0-9-]{20,}$/i;
const APP_ICON_PATH = path.join(__dirname, 'build', 'icon.png');
const APP_NAME = 'Deskprite';
const STORE_FILE_NAME = 'deskprite-pets.json';
const LEGACY_APP_NAME = ['Desk', 'Buddy'].join('');
const LEGACY_STORE_FILE_NAME = ['desk', 'buddy-pets.json'].join('');
const TEST_USER_DATA_PATH = process.env.DESKPRITE_TEST_USER_DATA;

app.setName(APP_NAME);
if (!app.isPackaged && TEST_USER_DATA_PATH && path.isAbsolute(TEST_USER_DATA_PATH)) {
  app.setPath('userData', TEST_USER_DATA_PATH);
}
const hasSingleInstanceLock = app.requestSingleInstanceLock();

let creatorWindow = null;
let tray = null;
let quitting = false;
let corruptStoreBackup = null;
const petWindows = new Map();
const openingPetWindows = new Map();
const petVisibility = createPetVisibilityState();
const dragOrigins = new Map();
const glideTimers = new Map();
const positionTimers = new Map();
const recentWanderDirections = new Map();
const WANDER_DIRECTIONS = [
  { key: 'east', x: 1, y: 0 },
  { key: 'west', x: -1, y: 0 },
  { key: 'south', x: 0, y: 1 },
  { key: 'north', x: 0, y: -1 },
  { key: 'south-east', x: 0.78, y: 0.62 },
  { key: 'north-west', x: -0.78, y: -0.62 },
  { key: 'south-west', x: -0.78, y: 0.62 },
  { key: 'north-east', x: 0.78, y: -0.62 },
];
let wanderTurn = 0;
let nextWanderStartAt = 0;
let writeQueue = Promise.resolve();

function appStorePath() {
  return path.join(app.getPath('userData'), STORE_FILE_NAME);
}

function petAssetDirectory() {
  return path.join(app.getPath('userData'), 'pets');
}

async function migrateLegacyData() {
  const targetStore = appStorePath();
  try {
    await fs.access(targetStore);
    return;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const legacyDataDirectory = path.join(app.getPath('appData'), LEGACY_APP_NAME);
  const legacyStore = path.join(legacyDataDirectory, LEGACY_STORE_FILE_NAME);
  try {
    await fs.access(legacyStore);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  const targetAssets = petAssetDirectory();
  const legacyAssets = path.join(legacyDataDirectory, 'pets');
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  if (path.resolve(legacyAssets) !== path.resolve(targetAssets)) {
    try {
      await fs.cp(legacyAssets, targetAssets, { recursive: true, force: false, errorOnExist: false });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  await fs.copyFile(legacyStore, targetStore);
}

function cleanAnimationFiles(value, petId) {
  if (!value || typeof value !== 'object') return null;
  const clips = {};
  for (const clip of ['idle', 'walk']) {
    const files = value[clip];
    if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FRAMES_PER_CLIP) return null;
    if (files.some((file) => (
      typeof file !== 'string'
      || path.basename(file) !== file
      || !file.startsWith(`${petId}-${clip}-`)
      || !file.endsWith('.png')
    ))) return null;
    clips[clip] = files;
  }
  return clips;
}

function cleanStore(value) {
  if (!value || !Array.isArray(value.pets)) throw new Error('Saved buddy data is invalid.');
  return {
    version: 2,
    pets: value.pets
      .filter((pet) => (
        pet
        && PET_ID.test(pet.id)
        && typeof pet.imageFile === 'string'
        && path.basename(pet.imageFile) === pet.imageFile
      ))
      .map((pet) => {
        const cleaned = { ...pet };
        cleaned.behavior = normalizePetBehavior(pet.behavior);
        const animationFiles = cleanAnimationFiles(pet.animationFiles, pet.id);
        if (animationFiles) cleaned.animationFiles = animationFiles;
        else delete cleaned.animationFiles;
        return cleaned;
      }),
  };
}

async function ensureStore() {
  await fs.mkdir(petAssetDirectory(), { recursive: true });
  try {
    await fs.access(appStorePath());
  } catch {
    await fs.writeFile(appStorePath(), JSON.stringify({ version: 2, pets: [] }, null, 2), 'utf8');
  }
}

async function readStore() {
  try {
    return cleanStore(JSON.parse(await fs.readFile(appStorePath(), 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: 2, pets: [] };
    if (!corruptStoreBackup) {
      corruptStoreBackup = `${appStorePath()}.backup-${Date.now()}.json`;
      await fs.copyFile(appStorePath(), corruptStoreBackup).catch(() => undefined);
    }
    throw new Error('Deskprite could not read the saved-buddies file. A backup was kept instead of overwriting it.');
  }
}

async function writeStore(store) {
  const target = appStorePath();
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(store, null, 2), 'utf8');
  await fs.rename(temporary, target);
}

function changeStore(change) {
  const task = writeQueue.then(async () => {
    const store = await readStore();
    const result = await change(store);
    await writeStore(store);
    return result;
  });
  writeQueue = task.catch(() => undefined);
  return task;
}

function validPetId(id) {
  return typeof id === 'string' && PET_ID.test(id);
}

function imageExtension(mimeType) {
  return { 'image/png': 'png' }[mimeType];
}

function decodeImage(dataUrl) {
  const buffer = decodePngDataUrl(dataUrl);
  const details = validatePngHeader(buffer);

  const native = nativeImage.createFromBuffer(buffer);
  const { width, height } = native.getSize();
  if (!width || !height || width * height > MAX_IMAGE_PIXELS) {
    throw new Error(ERROR_MESSAGES.imageTooLarge);
  }
  validatePixelInfo(native.toBitmap());
  return { buffer, mimeType: details.mimeType, width, height, hasTransparencyChannel: details.hasTransparencyChannel };
}

function decodeAnimationClip(value) {
  return value.map((frame) => decodeImage(frame));
}

function decodeAnimations(input) {
  const rawAnimations = input?.animations;
  if (!rawAnimations || typeof rawAnimations !== 'object') {
    const image = decodeImage(input?.imageData);
    return { idle: [image], walk: [image] };
  }
  validateAnimationFrameCounts(rawAnimations);

  const animations = {
    idle: decodeAnimationClip(rawAnimations.idle),
    walk: decodeAnimationClip(rawAnimations.walk),
  };
  const totalBytes = [...animations.idle, ...animations.walk]
    .reduce((total, frame) => total + frame.buffer.length, 0);
  validateAnimationByteSize(totalBytes);
  return animations;
}

async function findPet(id) {
  if (!validPetId(id)) throw new Error('That buddy could not be found.');
  const store = await readStore();
  const pet = store.pets.find((item) => item.id === id);
  if (!pet) throw new Error('That buddy could not be found.');
  return pet;
}

async function imageForPet(pet, thumbnail = false) {
  return imageForAsset(pet.imageFile, pet.mimeType, thumbnail);
}

async function imageForAsset(fileName, mimeType, thumbnail = false) {
  const safeFileName = path.basename(fileName);
  const imagePath = path.join(petAssetDirectory(), safeFileName);
  const data = await fs.readFile(imagePath);
  if (thumbnail) {
    const image = nativeImage.createFromBuffer(data);
    if (!image.isEmpty()) return image.resize({ width: 160, height: 160, quality: 'good' }).toDataURL();
  }
  return `data:${mimeType};base64,${data.toString('base64')}`;
}

function clipFilesForPet(pet, clip) {
  const files = pet.animationFiles?.[clip];
  return Array.isArray(files) && files.length > 0 ? files : [pet.imageFile];
}

async function animationImagesForPet(pet) {
  const result = {};
  for (const clip of ['idle', 'walk']) {
    result[clip] = await Promise.all(
      clipFilesForPet(pet, clip).map((fileName) => imageForAsset(fileName, pet.mimeType)),
    );
  }
  return result;
}

async function publicPet(pet, imageMode = 'full') {
  const result = {
    id: pet.id,
    name: pet.name,
    size: normalizePetSize(pet.size),
    motion: pet.motion === 'still' ? 'still' : 'wander',
    behavior: normalizePetBehavior(pet.behavior),
    shown: pet.shown !== false,
    createdAt: pet.createdAt,
  };
  if (imageMode !== 'none') {
    try {
      result.imageData = await imageForPet(pet, imageMode === 'thumbnail');
    } catch {
      result.imageData = null;
    }
  }
  if (imageMode === 'full') {
    try {
      result.animations = await animationImagesForPet(pet);
    } catch {
      result.animations = result.imageData
        ? { idle: [result.imageData], walk: [result.imageData] }
        : { idle: [], walk: [] };
    }
  }
  return result;
}

async function listPets() {
  const store = await readStore();
  return Promise.all(store.pets.map((pet) => publicPet(pet, 'thumbnail')));
}

function notifyPetsChanged() {
  if (creatorWindow && !creatorWindow.isDestroyed()) {
    creatorWindow.webContents.send('pets:changed');
  }
}

function onlyCreatorWindow(event) {
  if (!creatorWindow || creatorWindow.isDestroyed() || creatorWindow.webContents.id !== event.sender.id) {
    throw new Error('This action is only available from the Deskprite collection window.');
  }
}

function addSafeNavigation(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
}

function createCreatorWindow() {
  if (creatorWindow && !creatorWindow.isDestroyed()) {
    creatorWindow.focus();
    return creatorWindow;
  }

  creatorWindow = new BrowserWindow({
    width: 1080,
    height: 820,
    minWidth: 880,
    minHeight: 680,
    backgroundColor: '#1e2015',
    icon: app.isPackaged ? undefined : APP_ICON_PATH,
    title: 'Deskprite',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  creatorWindow.setMenuBarVisibility(false);
  addSafeNavigation(creatorWindow);
  creatorWindow.once('ready-to-show', () => creatorWindow?.show());
  creatorWindow.on('closed', () => { creatorWindow = null; });
  creatorWindow.loadFile(path.join(__dirname, 'src', 'creator.html'));
  return creatorWindow;
}

function petWindowSize(pet) {
  return petWindowMetrics(pet.size).windowSize;
}

function petSpriteSize(pet) {
  return petWindowMetrics(pet.size).spriteSize;
}

function petWindowInset(pet) {
  return petWindowMetrics(pet.size).inset;
}

function clampedPositionInArea(x, y, pet, area) {
  const size = petWindowSize(pet);
  const inset = petWindowInset(pet);
  return {
    x: Math.round(clamp(x, area.x - inset, Math.max(area.x - inset, area.x + area.width - size + inset))),
    y: Math.round(clamp(y, area.y - inset, Math.max(area.y - inset, area.y + area.height - size + inset))),
  };
}

function clampedPosition(x, y, pet) {
  const size = petWindowSize(pet);
  const display = screen.getDisplayNearestPoint({
    x: Math.round(x + size / 2),
    y: Math.round(y + size / 2),
  });
  return clampedPositionInArea(x, y, pet, display.workArea);
}

function wrappedPosition(x, y, pet, areas) {
  const spriteSize = petSpriteSize(pet);
  const inset = petWindowInset(pet);
  const workAreas = Array.isArray(areas) && areas.length
    ? areas
    : [screen.getPrimaryDisplay().workArea];
  const wrapped = wrapPositionInArea(
    x,
    y,
    combinedWorkArea(workAreas),
    spriteSize,
    inset,
  );
  return workAreas.length === 1
    ? wrapped
    : nearestVisiblePositionInAreas(wrapped.x, wrapped.y, workAreas, spriteSize, inset);
}

function stableNumber(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function combinedWorkArea(areas) {
  const workAreas = Array.isArray(areas) && areas.length
    ? areas
    : [screen.getPrimaryDisplay().workArea];
  const left = Math.min(...workAreas.map((area) => area.x));
  const top = Math.min(...workAreas.map((area) => area.y));
  const right = Math.max(...workAreas.map((area) => area.x + area.width));
  const bottom = Math.max(...workAreas.map((area) => area.y + area.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function workAreasForWander(window, pet) {
  const [x, y] = window.getPosition();
  const size = petWindowSize(pet);
  const display = screen.getDisplayNearestPoint({
    x: Math.round(x + size / 2),
    y: Math.round(y + size / 2),
  });
  if (normalizePetBehavior(pet.behavior).stayOnMonitor) return [display.workArea];
  const workAreas = screen.getAllDisplays().map((candidate) => candidate.workArea);
  return workAreas.length ? workAreas : [display.workArea];
}

function chooseWanderTarget(pet, x, y, movementAreas) {
  const petId = pet.id;
  const behavior = normalizePetBehavior(pet.behavior);
  const distanceRange = wanderDistanceRange(behavior.distance);
  const workAreas = Array.isArray(movementAreas) && movementAreas.length
    ? movementAreas
    : [screen.getPrimaryDisplay().workArea];
  const targetAreas = workAreas.map((area) => preferredAreaBounds(area, behavior.area));
  const spriteSize = petSpriteSize(pet);
  const inset = petWindowInset(pet);
  const now = Date.now();
  for (const [id, recent] of recentWanderDirections) {
    if (now - recent.startedAt > 6_000) recentWanderDirections.delete(id);
  }
  const recentlyUsed = new Set([...recentWanderDirections.values()].map((recent) => recent.direction));
  const firstDirection = (stableNumber(petId) + wanderTurn) % WANDER_DIRECTIONS.length;
  wanderTurn = (wanderTurn + 1) % WANDER_DIRECTIONS.length;
  let fallback = null;

  for (let offset = 0; offset < WANDER_DIRECTIONS.length; offset += 1) {
    const direction = WANDER_DIRECTIONS[(firstDirection + offset) % WANDER_DIRECTIONS.length];
    const distance = distanceRange.minimum
      + (stableNumber(`${petId}:${now}:${direction.key}`) % distanceRange.spread);
    const rawTarget = {
      x: x + direction.x * distance,
      y: y + direction.y * distance,
    };
    const target = nearestVisiblePositionInAreas(
      rawTarget.x,
      rawTarget.y,
      targetAreas,
      spriteSize,
      inset,
    );
    if (Math.hypot(target.x - x, target.y - y) < 44) continue;
    const choice = { target, direction: direction.key };
    if (!fallback) fallback = choice;
    if (!recentlyUsed.has(direction.key)) {
      recentWanderDirections.set(petId, { direction: direction.key, startedAt: now });
      return choice.target;
    }
  }

  if (fallback) {
    recentWanderDirections.set(petId, { direction: fallback.direction, startedAt: now });
    return fallback.target;
  }
  return null;
}

function claimWanderStart() {
  const now = Date.now();
  if (now < nextWanderStartAt) return false;
  nextWanderStartAt = now + 1_100 + Math.round(Math.random() * 700);
  return true;
}

function wanderRetryAfter() {
  return Math.max(800, nextWanderStartAt - Date.now());
}

function initialPosition(pet) {
  if (pet.position && Number.isFinite(pet.position.x) && Number.isFinite(pet.position.y)) {
    return clampedPosition(pet.position.x, pet.position.y, pet);
  }
  const area = screen.getPrimaryDisplay().workArea;
  const preferredArea = preferredAreaBounds(area, normalizePetBehavior(pet.behavior).area);
  const cascade = petWindows.size % 6;
  return clampedPositionInArea(
    preferredArea.x + preferredArea.width - petWindowSize(pet) - 42 - cascade * 29,
    preferredArea.y + preferredArea.height - petWindowSize(pet) - 60 - cascade * 27,
    pet,
    preferredArea,
  );
}

function schedulePositionSave(petId, window) {
  clearTimeout(positionTimers.get(petId));
  positionTimers.set(petId, setTimeout(() => {
    persistPosition(petId, window).catch(() => undefined);
  }, 350));
}

function sendPetAnimationState(petId, state, direction) {
  const window = petWindows.get(petId);
  if (window && !window.isDestroyed()) {
    window.webContents.send('pet:animation-state', { state, direction });
  }
}

function stopGlide(petId, announceIdle = true) {
  const timer = glideTimers.get(petId);
  if (timer) clearInterval(timer);
  glideTimers.delete(petId);
  if (announceIdle) sendPetAnimationState(petId, 'idle');
}

function glidePetWindow(petId, window, target, pet, areas) {
  stopGlide(petId, false);
  if (window.isDestroyed() || !window.isVisible()) return;

  const [startX, startY] = window.getPosition();
  const direction = target.x < startX ? 'left' : 'right';
  sendPetAnimationState(petId, 'walk', direction);
  const duration = 1900 + Math.round(Math.random() * 700);
  const startedAt = Date.now();
  const timer = setInterval(() => {
    if (glideTimers.get(petId) !== timer) {
      clearInterval(timer);
      return;
    }
    if (window.isDestroyed() || !window.isVisible()) {
      stopGlide(petId);
      return;
    }
    const progress = Math.min((Date.now() - startedAt) / duration, 1);
    const eased = progress < 0.5
      ? 2 * progress * progress
      : 1 - ((-2 * progress + 2) ** 2) / 2;
    const position = wrappedPosition(
      startX + (target.x - startX) * eased,
      startY + (target.y - startY) * eased,
      pet,
      areas,
    );
    window.setPosition(position.x, position.y, false);
    if (progress === 1) {
      stopGlide(petId);
      schedulePositionSave(petId, window);
    }
  }, 16);
  glideTimers.set(petId, timer);
}

function persistPosition(petId, window) {
  clearTimeout(positionTimers.get(petId));
  if (window.isDestroyed()) return Promise.resolve();
  const [x, y] = window.getPosition();
  return changeStore((store) => {
    const pet = store.pets.find((item) => item.id === petId);
    if (pet) pet.position = { x, y };
  });
}

async function persistOpenPetPositions() {
  await Promise.all([...petWindows.entries()].map(([petId, window]) => persistPosition(petId, window).catch(() => undefined)));
}

function setPetShown(petId, shown) {
  const visibilityOperation = petVisibility.begin(petId, shown);
  return changeStore((store) => {
    const pet = store.pets.find((item) => item.id === petId);
    if (!pet) throw new Error('That buddy could not be found.');
    pet.shown = Boolean(shown);
  }).catch((error) => {
    petVisibility.rollback(visibilityOperation);
    throw error;
  });
}

function resizePetWindow(window, pet) {
  const size = petWindowSize(pet);
  const bounds = window.getBounds();
  if (bounds.width === size && bounds.height === size) return false;

  const position = clampedPosition(
    bounds.x + Math.round((bounds.width - size) / 2),
    bounds.y + Math.round((bounds.height - size) / 2),
    pet,
  );
  if (size > Math.max(bounds.width, bounds.height)) {
    window.setMaximumSize(size, size);
  } else {
    window.setMinimumSize(size, size);
  }
  window.setBounds({ x: position.x, y: position.y, width: size, height: size }, false);
  window.setMinimumSize(size, size);
  window.setMaximumSize(size, size);
  return true;
}

async function applyPetUpdatesToOpenWindow(pet) {
  const opening = openingPetWindows.get(pet.id);
  if (opening) await opening;

  const window = petWindows.get(pet.id);
  if (!window || window.isDestroyed()) return;

  stopGlide(pet.id);
  dragOrigins.delete(pet.id);
  recentWanderDirections.delete(pet.id);
  clearTimeout(positionTimers.get(pet.id));
  positionTimers.delete(pet.id);
  if (resizePetWindow(window, pet)) schedulePositionSave(pet.id, window);
  if (!window.webContents.isDestroyed()) {
    try {
      await window.loadFile(path.join(__dirname, 'src', 'pet.html'), { query: { petId: pet.id } });
    } catch {
      throw new Error(ERROR_MESSAGES.generic);
    }
  }
}

async function removePetAsset(pet) {
  const files = new Set([pet.imageFile]);
  for (const clip of ['idle', 'walk']) {
    for (const fileName of clipFilesForPet(pet, clip)) files.add(fileName);
  }
  try {
    await Promise.all([...files].map(async (fileName) => {
      try {
        await fs.unlink(path.join(petAssetDirectory(), path.basename(fileName)));
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }));
  } catch {
    throw new Error('Deskprite could not remove that saved sprite. Please try again.');
  }
}

async function writeAnimationAssets(id, animations) {
  const animationFiles = {};
  const writtenFiles = [];
  try {
    for (const clip of ['idle', 'walk']) {
      animationFiles[clip] = [];
      for (const [index, frame] of animations[clip].entries()) {
        const fileName = `${id}-${clip}-${index}.${imageExtension(frame.mimeType)}`;
        await fs.writeFile(path.join(petAssetDirectory(), fileName), frame.buffer);
        animationFiles[clip].push(fileName);
        writtenFiles.push(fileName);
      }
    }
    return animationFiles;
  } catch {
    await Promise.all(writtenFiles.map((fileName) => (
      fs.unlink(path.join(petAssetDirectory(), fileName)).catch(() => undefined)
    )));
    throw new Error('Deskprite could not save those sprite frames. Please try again.');
  }
}

async function openPetWindow(id) {
  const existing = petWindows.get(id);
  if (existing && !existing.isDestroyed()) {
    if (petVisibility.get(id, true)) {
      existing.show();
      existing.focus();
    }
    return;
  }

  const alreadyOpening = openingPetWindows.get(id);
  if (alreadyOpening) return alreadyOpening;

  const opening = createPetWindow(id);
  openingPetWindows.set(id, opening);
  try {
    return await opening;
  } finally {
    openingPetWindows.delete(id);
  }
}

async function createPetWindow(id) {
  const pet = await findPet(id);
  const position = initialPosition(pet);
  const size = petWindowSize(pet);
  const window = new BrowserWindow({
    x: position.x,
    y: position.y,
    width: size,
    height: size,
    minWidth: size,
    minHeight: size,
    maxWidth: size,
    maxHeight: size,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  addSafeNavigation(window);
  petWindows.set(id, window);
  installReadyToShowGate(window, () => petVisibility.get(id, pet.shown !== false));
  window.on('moved', () => schedulePositionSave(id, window));
  window.on('close', () => { persistPosition(id, window).catch(() => undefined); });
  window.on('closed', () => {
    stopGlide(id);
    if (petWindows.get(id) === window) petWindows.delete(id);
    dragOrigins.delete(id);
    recentWanderDirections.delete(id);
    clearTimeout(positionTimers.get(id));
    notifyPetsChanged();
  });
  try {
    await window.loadFile(path.join(__dirname, 'src', 'pet.html'), { query: { petId: id } });
  } catch {
    window.close();
    throw new Error('Deskprite could not open that buddy. Try showing it again.');
  }
}

function onlyThisPetWindow(event, petId) {
  if (!validPetId(petId)) throw new Error('Invalid buddy.');
  const window = petWindows.get(petId);
  if (!window || window.isDestroyed() || window.webContents.id !== event.sender.id) {
    throw new Error('This action is not available.');
  }
  return window;
}

function dragCoordinates(payload) {
  const screenX = Number(payload?.screenX);
  const screenY = Number(payload?.screenY);
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) throw new Error('Invalid drag position.');
  return { screenX, screenY };
}

ipcMain.handle('pets:list', (event) => {
  onlyCreatorWindow(event);
  return listPets();
});

ipcMain.handle('pets:validate-image', (event, imageData) => {
  onlyCreatorWindow(event);
  const image = decodeImage(imageData);
  return { width: image.width, height: image.height, mimeType: image.mimeType };
});

ipcMain.handle('pets:create', async (event, input) => {
  onlyCreatorWindow(event);
  const animations = decodeAnimations(input);
  const id = `pet-${crypto.randomUUID()}`;
  const mimeType = animations.idle[0].mimeType;
  const animationFiles = await writeAnimationAssets(id, animations);
  const pet = {
    id,
    name: cleanPetName(input?.name),
    size: normalizePetSize(input?.size),
    motion: input?.motion === 'still' ? 'still' : 'wander',
    behavior: normalizePetBehavior(input?.behavior),
    mimeType,
    imageFile: animationFiles.idle[0],
    animationFiles,
    createdAt: new Date().toISOString(),
    shown: true,
  };

  try {
    await changeStore((nextStore) => {
      if (nextStore.pets.length >= MAX_PETS) {
        throw new Error('Deskprite can keep up to 30 buddies. Delete one before adding another.');
      }
      nextStore.pets.push(pet);
    });
  } catch (error) {
    await removePetAsset(pet).catch(() => undefined);
    throw error;
  }
  try {
    await openPetWindow(id);
  } catch {
    pet.shown = false;
    await setPetShown(id, false);
  }
  notifyPetsChanged();
  return publicPet(pet);
});

ipcMain.handle('pets:update', async (event, petId, input) => {
  onlyCreatorWindow(event);
  if (!validPetId(petId)) throw new Error('That buddy could not be found.');
  const updates = cleanPetUpdates(input);
  const pet = await changeStore((store) => {
    const savedPet = store.pets.find((item) => item.id === petId);
    if (!savedPet) throw new Error('That buddy could not be found.');
    const { behavior: behaviorUpdates, ...ordinaryUpdates } = updates;
    Object.assign(savedPet, ordinaryUpdates);
    if (behaviorUpdates) {
      savedPet.behavior = mergePetBehavior(savedPet.behavior, behaviorUpdates);
    }
    return { ...savedPet };
  });

  try {
    await applyPetUpdatesToOpenWindow(pet);
  } catch {
    pet.shown = false;
    await setPetShown(pet.id, false);
    const window = petWindows.get(pet.id);
    if (window && !window.isDestroyed()) {
      window.hide();
      window.close();
    }
  }
  notifyPetsChanged();
  return publicPet(pet, 'thumbnail');
});

ipcMain.handle('pets:launch', async (event, petId) => {
  onlyCreatorWindow(event);
  await setPetShown(petId, true);
  try {
    await openPetWindow(petId);
  } catch (error) {
    await setPetShown(petId, false);
    notifyPetsChanged();
    throw error;
  }
  notifyPetsChanged();
  return true;
});

ipcMain.handle('pets:hide', async (event, petId) => {
  onlyCreatorWindow(event);
  if (!validPetId(petId)) throw new Error('Invalid buddy.');
  await setPetShown(petId, false);
  const window = petWindows.get(petId);
  if (window && !window.isDestroyed()) {
    await persistPosition(petId, window);
    stopGlide(petId);
    window.hide();
  }
  notifyPetsChanged();
  return true;
});

ipcMain.handle('pets:delete', async (event, petId) => {
  onlyCreatorWindow(event);
  const pet = await findPet(petId);
  await removePetAsset(pet);
  const window = petWindows.get(petId);
  if (window && !window.isDestroyed()) window.close();
  await changeStore((store) => {
    store.pets = store.pets.filter((item) => item.id !== petId);
  });
  petVisibility.delete(petId);
  notifyPetsChanged();
  return true;
});

ipcMain.handle('pet:get', async (event, petId) => {
  onlyThisPetWindow(event, petId);
  return publicPet(await findPet(petId));
});

ipcMain.handle('pet:drag-start', async (event, payload) => {
  const petId = payload?.petId;
  const window = onlyThisPetWindow(event, petId);
  const { screenX, screenY } = dragCoordinates(payload);
  const pet = await findPet(petId);
  stopGlide(petId, false);
  sendPetAnimationState(petId, 'walk');
  const [x, y] = window.getPosition();
  const behavior = normalizePetBehavior(pet.behavior);
  const size = petWindowSize(pet);
  const lockedArea = behavior.stayOnMonitor
    ? screen.getDisplayNearestPoint({ x: Math.round(x + size / 2), y: Math.round(y + size / 2) }).workArea
    : null;
  dragOrigins.set(petId, { screenX, screenY, x, y, pet, lockedArea });
  return true;
});

ipcMain.handle('pet:drag-move', (event, payload) => {
  const petId = payload?.petId;
  const window = onlyThisPetWindow(event, petId);
  const origin = dragOrigins.get(petId);
  if (!origin) return false;
  const { screenX, screenY } = dragCoordinates(payload);
  const targetX = origin.x + screenX - origin.screenX;
  const targetY = origin.y + screenY - origin.screenY;
  const next = origin.lockedArea
    ? clampedPositionInArea(targetX, targetY, origin.pet, origin.lockedArea)
    : clampedPosition(targetX, targetY, origin.pet);
  window.setPosition(next.x, next.y, false);
  return true;
});

ipcMain.handle('pet:drag-end', (event, petId) => {
  const window = onlyThisPetWindow(event, petId);
  dragOrigins.delete(petId);
  return persistPosition(petId, window).then(() => {
    sendPetAnimationState(petId, 'idle');
    return true;
  });
});

ipcMain.handle('pet:nudge', async (event, petId) => {
  const window = onlyThisPetWindow(event, petId);
  if (!window.isVisible()) return { started: false, retryAfter: 2_500 };
  const pet = await findPet(petId);
  if (pet.motion === 'still') return { started: false, retryAfter: 2_500 };
  if (dragOrigins.has(petId) || glideTimers.has(petId)) return { started: false, retryAfter: 1_800 };
  if (!claimWanderStart()) return { started: false, retryAfter: wanderRetryAfter() };
  const [x, y] = window.getPosition();
  const areas = workAreasForWander(window, pet);
  const next = chooseWanderTarget(pet, x, y, areas);
  if (!next) return { started: false, retryAfter: wanderRetryAfter() };
  glidePetWindow(petId, window, next, pet, areas);
  return { started: true };
});

function createTrayIcon() {
  const width = 16;
  const pixels = Buffer.alloc(width * width * 4);
  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = Math.hypot(x - 7.5, y - 7.5);
      if (distance > 7.3) continue;
      const offset = (y * width + x) * 4;
      const highlight = y < 6 && x < 7;
      pixels[offset] = highlight ? 170 : 112;
      pixels[offset + 1] = highlight ? 178 : 111;
      pixels[offset + 2] = highlight ? 252 : 220;
      pixels[offset + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(pixels, { width, height: width, scaleFactor: 1 });
}

async function showAllPets() {
  const store = await readStore();
  const visibilityOperations = petVisibility.beginMany(store.pets.map((pet) => pet.id), true);
  try {
    await changeStore((nextStore) => {
      petVisibility.beginMany(nextStore.pets.map((pet) => pet.id), true, visibilityOperations);
      for (const pet of nextStore.pets) {
        pet.shown = true;
      }
    });
  } catch (error) {
    for (const operation of visibilityOperations.values()) petVisibility.rollback(operation);
    throw error;
  }
  await Promise.all(store.pets.map(async (pet) => {
    try {
      await openPetWindow(pet.id);
    } catch {
      await setPetShown(pet.id, false);
    }
  }));
  notifyPetsChanged();
}

async function hideAllPets() {
  const store = await readStore();
  const visibilityOperations = petVisibility.beginMany(store.pets.map((pet) => pet.id), false);
  try {
    await changeStore((nextStore) => {
      petVisibility.beginMany(nextStore.pets.map((pet) => pet.id), false, visibilityOperations);
      for (const pet of nextStore.pets) {
        pet.shown = false;
      }
    });
  } catch (error) {
    for (const operation of visibilityOperations.values()) petVisibility.rollback(operation);
    throw error;
  }
  await persistOpenPetPositions();
  for (const window of petWindows.values()) {
    if (!window.isDestroyed()) window.hide();
  }
  for (const petId of petWindows.keys()) stopGlide(petId);
  notifyPetsChanged();
}

async function restoreShownPets() {
  const store = await readStore();
  let changed = false;
  await Promise.all(store.pets.filter((pet) => pet.shown !== false).map(async (pet) => {
    try {
      await openPetWindow(pet.id);
    } catch {
      changed = true;
      await setPetShown(pet.id, false);
    }
  }));
  if (changed) notifyPetsChanged();
}

async function requestQuit() {
  if (quitting) return;
  quitting = true;
  await persistOpenPetPositions();
  app.quit();
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Deskprite');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Deskprite', click: () => createCreatorWindow() },
    { label: 'Show all buddies', click: () => showAllPets().catch(() => undefined) },
    { label: 'Hide all buddies', click: () => hideAllPets().catch(() => undefined) },
    { type: 'separator' },
    { label: 'Quit Deskprite', click: () => requestQuit() },
  ]));
  tray.on('click', () => createCreatorWindow());
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!app.isReady()) return;
    const window = createCreatorWindow();
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  app.whenReady().then(async () => {
    try {
      if (!app.isPackaged && process.platform === 'darwin' && app.dock) {
        const dockIcon = nativeImage.createFromPath(APP_ICON_PATH);
        if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
      }
      await migrateLegacyData();
      await ensureStore();
      session.defaultSession.setPermissionCheckHandler(() => false);
      session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
      createTray();
      createCreatorWindow();
      restoreShownPets().catch(() => undefined);

      app.on('activate', () => createCreatorWindow());
    } catch (error) {
      dialog.showErrorBox(
        'Deskprite could not start',
        friendlyErrorMessage(error, 'Deskprite could not access its local storage.'),
      );
      app.quit();
    }
  });

  app.on('before-quit', (event) => {
    if (!quitting) {
      event.preventDefault();
      requestQuit();
    }
  });
}
