const {
  MAX_FRAMES_PER_CLIP,
  ERROR_MESSAGES,
  validateUploadMetadata,
  validateAnimationFrameCounts,
  frameRect,
  friendlyErrorMessage,
  normalizePetBehavior,
} = window.DeskpriteCore;
const { createLatestOperationGuard } = window.DeskpriteAsyncState;
const MAX_SHEET_COLUMNS = 32;
const MAX_SHEET_ROWS = 32;
const DRAW_SIZE = 160;
const PREVIEW_SPEEDS = Object.freeze({ idle: 420, walk: 135 });
const BEHAVIOR_LABELS = Object.freeze({
  frequency: Object.freeze({ rare: 'Every so often', normal: 'Regularly', often: 'Often' }),
  distance: Object.freeze({ short: 'Short trips', normal: 'Medium trips', long: 'Long trips' }),
  area: Object.freeze({ anywhere: 'Anywhere', top: 'Top', bottom: 'Bottom', left: 'Left side', right: 'Right side' }),
});
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const PRESET_LAYOUT = Object.freeze({
  columns: 4,
  rows: 2,
  idle: { row: 0, start: 0, frames: 4 },
  walk: { row: 1, start: 0, frames: 4 },
});
const PRESETS = Object.freeze({
  sprout: { name: 'Sprout', sheet: 'assets/presets/sprout-sheet.png' },
  mochi: { name: 'Mochi', sheet: 'assets/presets/mochi-sheet.png' },
  miso: { name: 'Miso', sheet: 'assets/presets/miso-sheet.png' },
  taro: { name: 'Taro', sheet: 'assets/presets/taro-sheet.png' },
  honey: { name: 'Honey', sheet: 'assets/presets/honey-sheet.png' },
  button: { name: 'Button', sheet: 'assets/presets/button-sheet.png' },
  nori: { name: 'Nori', sheet: 'assets/presets/nori-sheet.png' },
  maple: { name: 'Maple', sheet: 'assets/presets/maple-sheet.png' },
  pudding: { name: 'Pudding', sheet: 'assets/presets/pudding-sheet.png' },
});

const form = document.querySelector('#pet-form');
const imageInput = document.querySelector('#image-input');
const uploadZone = document.querySelector('#upload-zone');
const presetPanel = document.querySelector('#preset-panel');
const presetStatus = document.querySelector('#preset-status');
const presetChoices = [...document.querySelectorAll('[data-preset-id]')];
const importPanel = document.querySelector('#import-panel');
const drawPanel = document.querySelector('#draw-panel');
const modeButtons = [...document.querySelectorAll('[data-creation-mode]')];
const layoutInputs = {
  columns: document.querySelector('#sheet-columns'),
  rows: document.querySelector('#sheet-rows'),
  idleRow: document.querySelector('#idle-row'),
  idleStart: document.querySelector('#idle-start'),
  idleFrames: document.querySelector('#idle-frames'),
  walkRow: document.querySelector('#walk-row'),
  walkStart: document.querySelector('#walk-start'),
  walkFrames: document.querySelector('#walk-frames'),
};
const sheetStatus = document.querySelector('#sheet-status');
const sheetInfo = document.querySelector('#sheet-info');
const sheetDimensions = document.querySelector('#sheet-dimensions');
const sheetPreviewImage = document.querySelector('#sheet-preview-image');
const sheetGridOverlay = document.querySelector('#sheet-grid-overlay');
const gridChoices = document.querySelector('#grid-choices');
const nameInput = document.querySelector('#name-input');
const sizeInput = document.querySelector('#size-input');
const sizeOutput = document.querySelector('#size-output');
const motionInputs = [...document.querySelectorAll('input[name="motion"]')];
const behaviorInputs = {
  frequency: document.querySelector('#behavior-frequency'),
  distance: document.querySelector('#behavior-distance'),
  area: document.querySelector('#behavior-area'),
  stayOnMonitor: document.querySelector('#stay-on-monitor'),
};
const createButton = document.querySelector('#create-button');
const message = document.querySelector('#form-message');
const previewPet = document.querySelector('#preview-pet');
const previewImage = document.querySelector('#preview-image');
const previewSymbol = document.querySelector('#preview-symbol');
const previewName = document.querySelector('#preview-name');
const previewCard = document.querySelector('.preview-card');
const previewClipButtons = [...document.querySelectorAll('[data-preview-clip]')];
const previewMotionToggle = document.querySelector('#preview-motion-toggle');
const previewClipStatus = document.querySelector('#preview-clip-status');
const petList = document.querySelector('#pet-list');
const emptyState = document.querySelector('#empty-state');
const buddyCount = document.querySelector('#buddy-count');

const canvas = document.querySelector('#sprite-canvas');
const context = canvas.getContext('2d', { willReadFrequently: true });
const brushColor = document.querySelector('#brush-color');
const brushSize = document.querySelector('#brush-size');
const brushSizeOutput = document.querySelector('#brush-size-output');
const onionToggle = document.querySelector('#onion-toggle');
const onionOpacity = document.querySelector('#onion-opacity');
const onionOpacityOutput = document.querySelector('#onion-opacity-output');
const onionSkin = document.querySelector('#onion-skin');
const brushTool = document.querySelector('#brush-tool');
const eraserTool = document.querySelector('#eraser-tool');
const clearFrameButton = document.querySelector('#clear-frame');
const clipButtons = [...document.querySelectorAll('[data-clip]')];
const drawFrameStatus = document.querySelector('#draw-frame-status');
const drawFrameList = document.querySelector('#draw-frame-list');
const previousFrameButton = document.querySelector('#previous-frame');
const nextFrameButton = document.querySelector('#next-frame');
const addFrameButton = document.querySelector('#add-frame');
const deleteFrameButton = document.querySelector('#delete-frame');

let creationMode = 'preset';
let selectedPresetId = null;
let presetAnimations = null;
let presetLoadVersion = 0;
let previewTimer = null;
let previewAnimations = null;
let previewClip = 'idle';
let previewFrameIndex = 0;
let previewPaused = false;
const presetAnimationCache = new Map();
let selectedSheetData = null;
let importedAnimations = null;
let selectedSheetMeta = null;
let sheetGridChosen = false;
const importLoadGuard = createLatestOperationGuard();
const importBuildGuard = createLatestOperationGuard();
let activeClip = 'idle';
let activeFrame = 0;
let drawingTool = 'brush';
let isDrawing = false;
let lastPoint = null;
let frameLoadVersion = 0;
let drawingFrames = {
  idle: [blankFrame()],
  walk: [blankFrame()],
};

function blankFrame() {
  const blank = document.createElement('canvas');
  blank.width = DRAW_SIZE;
  blank.height = DRAW_SIZE;
  return blank.toDataURL('image/png');
}

function setCreateButton(isWorking) {
  createButton.disabled = isWorking;
  for (const control of [
    ...modeButtons,
    ...presetChoices,
    nameInput,
    sizeInput,
    ...motionInputs,
    ...Object.values(behaviorInputs),
  ]) {
    control.disabled = isWorking;
  }
  createButton.replaceChildren();
  createButton.append(document.createTextNode(isWorking ? 'Saving your frames…' : 'Create & launch '));
  if (!isWorking) {
    const arrow = document.createElement('span');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '→';
    createButton.append(arrow);
  }
}

function setMessage(text = '', isSuccess = false) {
  message.textContent = text;
  message.classList.toggle('success', isSuccess);
}

function setSheetStatus(text = '') {
  sheetStatus.textContent = text || 'Tip: use the same row, starting column, and frame count for idle and walk when your sheet has one animation.';
}

function setPreview(imageData) {
  const hasImage = Boolean(imageData);
  previewImage.hidden = !hasImage;
  previewSymbol.hidden = hasImage;
  previewPet.classList.toggle('preview-placeholder', !hasImage);
  previewImage.src = hasImage ? imageData : '';
}

function stopAnimationPreview() {
  if (previewTimer) window.clearInterval(previewTimer);
  previewTimer = null;
}

function previewAnimationsForMode() {
  if (creationMode === 'preset') return presetAnimations;
  if (creationMode === 'import') return importedAnimations;
  return drawingFrames;
}

function updatePreviewControls(frames = []) {
  for (const button of previewClipButtons) {
    const clip = button.dataset.previewClip;
    const selected = clip === previewClip;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
    button.disabled = !Array.isArray(previewAnimations?.[clip]) || previewAnimations[clip].length === 0;
  }

  const systemReduced = reducedMotion.matches;
  previewMotionToggle.disabled = systemReduced || frames.length < 2;
  previewMotionToggle.setAttribute('aria-pressed', String(previewPaused));
  previewMotionToggle.textContent = systemReduced
    ? 'Motion reduced'
    : previewPaused
      ? 'Play preview'
      : 'Pause preview';

  const state = systemReduced ? 'motion reduced' : previewPaused ? 'paused' : 'playing';
  const clipName = previewClip === 'walk' ? 'Walk' : 'Idle';
  const frameLabel = `${frames.length} ${frames.length === 1 ? 'frame' : 'frames'}`;
  previewClipStatus.textContent = frames.length ? `${clipName} · ${frameLabel} · ${state}` : `${clipName} preview unavailable`;
  previewPet.classList.toggle('is-preview-walking', previewClip === 'walk' && frames.length > 0);
  previewPet.classList.toggle('is-preview-paused', systemReduced || previewPaused || frames.length < 2);
}

function playAnimationPreview(animations = previewAnimationsForMode()) {
  stopAnimationPreview();
  previewAnimations = animations || null;
  const frames = Array.isArray(previewAnimations?.[previewClip]) ? previewAnimations[previewClip] : [];
  previewFrameIndex = 0;
  setPreview(frames[0] || null);
  updatePreviewControls(frames);
  if (reducedMotion.matches || previewPaused || frames.length < 2) return;

  previewTimer = window.setInterval(() => {
    previewFrameIndex = (previewFrameIndex + 1) % frames.length;
    setPreview(frames[previewFrameIndex]);
  }, PREVIEW_SPEEDS[previewClip]);
}

function selectPreviewClip(clip) {
  if (clip !== 'idle' && clip !== 'walk') return;
  previewClip = clip;
  playAnimationPreview();
}

function updatePreviewSize() {
  const size = Math.max(64, Math.min(192, Number(sizeInput.value) || 112));
  sizeOutput.value = `${size} px`;
  previewCard.style.setProperty('--preview-pet-size', `${size}px`);
  previewCard.style.setProperty('--preview-shadow-size', `${Math.max(44, Math.round(size * 0.62))}px`);
}

function updatePreviewName() {
  const name = nameInput.value.trim().replace(/\s+/g, ' ');
  previewName.textContent = name || 'Your new buddy';
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('That sprite sheet could not be read. Try another one.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(imageData) {
  return new Promise((resolve, reject) => {
    const source = new Image();
    source.onload = () => resolve(source);
    source.onerror = () => reject(new Error('Deskprite could not inspect that PNG.'));
    source.src = imageData;
  });
}

async function pixelsIn(imageData, predicate) {
  const source = await loadImage(imageData);
  const probe = document.createElement('canvas');
  probe.width = source.naturalWidth;
  probe.height = source.naturalHeight;
  const probeContext = probe.getContext('2d', { willReadFrequently: true });
  if (!probeContext) throw new Error('Deskprite could not inspect that PNG.');
  probeContext.drawImage(source, 0, 0);
  const pixels = probeContext.getImageData(0, 0, probe.width, probe.height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (predicate(pixels[index])) return true;
  }
  return false;
}

function imageHasTransparentPixels(imageData) {
  return pixelsIn(imageData, (alpha) => alpha < 250);
}

function imageHasVisiblePixels(imageData) {
  return pixelsIn(imageData, (alpha) => alpha > 4);
}

function boundedInteger(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

function sheetLayout() {
  const columns = boundedInteger(layoutInputs.columns.value, 1, MAX_SHEET_COLUMNS, 'Columns');
  const rows = boundedInteger(layoutInputs.rows.value, 1, MAX_SHEET_ROWS, 'Rows');
  const clipLayout = (clipName, rowValue, startValue, frameValue) => {
    const frames = boundedInteger(frameValue, 1, Math.min(MAX_FRAMES_PER_CLIP, columns), `${clipName} frames`);
    const start = boundedInteger(startValue, 1, columns - frames + 1, `${clipName} start column`);
    return {
      row: boundedInteger(rowValue, 1, rows, `${clipName} row`) - 1,
      start: start - 1,
      frames,
    };
  };
  return {
    columns,
    rows,
    idle: clipLayout('Idle', layoutInputs.idleRow.value, layoutInputs.idleStart.value, layoutInputs.idleFrames.value),
    walk: clipLayout('Walk', layoutInputs.walkRow.value, layoutInputs.walkStart.value, layoutInputs.walkFrames.value),
  };
}

function updateSheetMap(layout = null) {
  sheetPreviewImage.src = selectedSheetData || '';
  if (selectedSheetMeta) {
    sheetPreviewImage.alt = `Uploaded ${selectedSheetMeta.width} by ${selectedSheetMeta.height} pixel sprite sheet`;
  } else {
    sheetPreviewImage.alt = 'Uploaded sprite sheet';
  }
  sheetGridOverlay.replaceChildren();
  sheetGridOverlay.hidden = !layout;
  if (!layout) return;

  sheetGridOverlay.style.gridTemplateColumns = `repeat(${layout.columns}, minmax(0, 1fr))`;
  sheetGridOverlay.style.gridTemplateRows = `repeat(${layout.rows}, minmax(0, 1fr))`;
  const cells = [];
  for (let row = 0; row < layout.rows; row += 1) {
    for (let column = 0; column < layout.columns; column += 1) {
      const cell = document.createElement('span');
      cell.className = 'sheet-grid-cell';
      const isIdle = row === layout.idle.row
        && column >= layout.idle.start
        && column < layout.idle.start + layout.idle.frames;
      const isWalk = row === layout.walk.row
        && column >= layout.walk.start
        && column < layout.walk.start + layout.walk.frames;
      cell.classList.toggle('is-idle', isIdle);
      cell.classList.toggle('is-walk', isWalk);
      cells.push(cell);
    }
  }
  sheetGridOverlay.replaceChildren(...cells);
}

function squareGridChoices(width, height) {
  const choices = [];
  for (let columns = 1; columns <= MAX_SHEET_COLUMNS; columns += 1) {
    if (width % columns !== 0) continue;
    const cellWidth = width / columns;
    for (let rows = 1; rows <= MAX_SHEET_ROWS; rows += 1) {
      if (height % rows !== 0) continue;
      const cellHeight = height / rows;
      if (cellWidth === cellHeight && cellWidth >= 16) {
        choices.push({ columns, rows, cellSize: cellWidth });
      }
    }
  }
  return choices.sort((a, b) => b.cellSize - a.cellSize).slice(0, 6);
}

function updateGridChoiceState() {
  const columns = Number(layoutInputs.columns.value);
  const rows = Number(layoutInputs.rows.value);
  for (const choice of gridChoices.querySelectorAll('button')) {
    const selected = sheetGridChosen
      && Number(choice.dataset.columns) === columns
      && Number(choice.dataset.rows) === rows;
    choice.classList.toggle('active', selected);
    choice.setAttribute('aria-pressed', String(selected));
  }
}

function applyGridChoice(choice) {
  sheetGridChosen = true;
  const frameCount = Math.min(4, choice.columns, MAX_FRAMES_PER_CLIP);
  layoutInputs.columns.value = String(choice.columns);
  layoutInputs.rows.value = String(choice.rows);
  layoutInputs.idleRow.value = '1';
  layoutInputs.idleStart.value = '1';
  layoutInputs.idleFrames.value = String(frameCount);
  layoutInputs.walkRow.value = String(choice.rows > 1 ? 2 : 1);
  layoutInputs.walkStart.value = '1';
  layoutInputs.walkFrames.value = String(frameCount);
  updateGridChoiceState();
}

function renderSheetInfo(width, height) {
  selectedSheetMeta = { width, height };
  const choices = squareGridChoices(width, height);
  sheetGridChosen = false;
  sheetInfo.hidden = false;
  sheetDimensions.textContent = `${width} × ${height}px sheet · pick a square cell size that matches one full character.`;
  updateSheetMap();
  gridChoices.replaceChildren(...choices.map((choice) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'grid-choice';
    button.dataset.columns = String(choice.columns);
    button.dataset.rows = String(choice.rows);
    button.setAttribute('aria-pressed', 'false');
    button.textContent = `${choice.columns} × ${choice.rows} · ${choice.cellSize}px`;
    button.addEventListener('click', async () => {
      applyGridChoice(choice);
      if (!selectedSheetData) return;
      try {
        const animations = await rebuildImportedAnimations();
        if (animations) setMessage();
      } catch (error) {
        importedAnimations = null;
        updateSheetMap();
        if (creationMode === 'import') playAnimationPreview(null);
        setSheetStatus('Check your row, column, and frame values.');
        setMessage(friendlyErrorMessage(error));
      }
    });
    return button;
  }));
  updateGridChoiceState();
  if (!choices.length) {
    setSheetStatus('No square frame grid fits this image. Re-export it as a sheet made of equal square cells.');
  }
  return choices.length > 0;
}

async function splitSpriteSheet(imageData, layoutOverride = null) {
  if (!layoutOverride && !sheetGridChosen) {
    throw new Error('Choose a square cell grid above before making your buddy.');
  }
  const layout = layoutOverride || sheetLayout();
  const source = await loadImage(imageData);
  const firstFrame = frameRect(source.naturalWidth, source.naturalHeight, layout, 'idle', 0);
  const frameWidth = firstFrame.width;
  const frameHeight = firstFrame.height;
  if (frameWidth < 16 || frameHeight < 16 || frameWidth * frameHeight > 4_000_000) {
    throw new Error('Each frame must be at least 16 × 16 pixels and no larger than 4 megapixels.');
  }

  const clips = {};
  for (const clip of ['idle', 'walk']) {
    clips[clip] = [];
    for (let column = 0; column < layout[clip].frames; column += 1) {
      const sourceFrame = frameRect(source.naturalWidth, source.naturalHeight, layout, clip, column);
      const frame = document.createElement('canvas');
      frame.width = frameWidth;
      frame.height = frameHeight;
      const frameContext = frame.getContext('2d');
      if (!frameContext) throw new Error('Deskprite could not split that sprite sheet.');
      frameContext.drawImage(
        source,
        sourceFrame.x,
        sourceFrame.y,
        sourceFrame.width,
        sourceFrame.height,
        0,
        0,
        frameWidth,
        frameHeight,
      );
      const data = frame.toDataURL('image/png');
      if (!await imageHasVisiblePixels(data)) {
        throw new Error(`The ${clip} row contains an empty frame. Check the row and frame settings.`);
      }
      clips[clip].push(data);
    }
  }
  return { clips, layout, frameWidth, frameHeight };
}

async function rebuildImportedAnimations() {
  const sheetData = selectedSheetData;
  if (!sheetData) return null;
  const operation = importBuildGuard.begin();
  let result;
  try {
    result = await splitSpriteSheet(sheetData);
  } catch (error) {
    if (!importBuildGuard.isCurrent(operation) || sheetData !== selectedSheetData) return null;
    throw error;
  }
  if (!importBuildGuard.isCurrent(operation) || sheetData !== selectedSheetData) return null;

  const { clips: animations, layout, frameWidth, frameHeight } = result;
  importedAnimations = animations;
  updateGridChoiceState();
  updateSheetMap(layout);
  if (creationMode === 'import') playAnimationPreview(animations);
  const range = (clip) => `row ${layout[clip].row + 1}, columns ${layout[clip].start + 1}–${layout[clip].start + layout[clip].frames}`;
  setSheetStatus(`Ready: ${frameWidth} × ${frameHeight}px cells · idle ${range('idle')} · walk ${range('walk')}.`);
  return animations;
}

async function loadPresetAnimations(presetId) {
  if (presetAnimationCache.has(presetId)) return presetAnimationCache.get(presetId);
  const preset = PRESETS[presetId];
  if (!preset) throw new Error('That starter buddy is not available.');
  const sheetUrl = new URL(preset.sheet, document.baseURI).href;
  const { clips } = await splitSpriteSheet(sheetUrl, PRESET_LAYOUT);
  const frames = [...clips.idle, ...clips.walk];
  const transparencyChecks = await Promise.all(frames.map(imageHasTransparentPixels));
  if (transparencyChecks.some((hasTransparency) => !hasTransparency)) {
    throw new Error(`${preset.name}'s sprite frames are missing transparency.`);
  }
  presetAnimationCache.set(presetId, clips);
  return clips;
}

async function selectPreset(presetId, { updateName = true } = {}) {
  const preset = PRESETS[presetId];
  if (!preset) return;
  const loadVersion = ++presetLoadVersion;
  selectedPresetId = presetId;
  presetAnimations = presetAnimationCache.get(presetId) || null;
  stopAnimationPreview();
  for (const choice of presetChoices) {
    const isActive = choice.dataset.presetId === presetId;
    choice.classList.toggle('active', isActive);
    choice.setAttribute('aria-pressed', String(isActive));
  }
  if (updateName) {
    nameInput.value = preset.name;
    updatePreviewName();
  }
  presetPanel.setAttribute('aria-busy', 'true');
  presetStatus.textContent = `Loading ${preset.name}…`;
  if (creationMode === 'preset') {
    playAnimationPreview(presetAnimations);
  }
  setMessage();
  try {
    const animations = await loadPresetAnimations(presetId);
    if (loadVersion !== presetLoadVersion) return;
    presetAnimations = animations;
    if (creationMode === 'preset') playAnimationPreview(animations);
    presetStatus.textContent = `${preset.name} is ready · 4 idle + 4 walk frames.`;
  } catch (error) {
    if (loadVersion !== presetLoadVersion) return;
    presetAnimations = null;
    if (creationMode === 'preset') playAnimationPreview(null);
    presetStatus.textContent = 'This starter could not be loaded.';
    throw error;
  } finally {
    if (loadVersion === presetLoadVersion) presetPanel.removeAttribute('aria-busy');
  }
}

async function useFile(file) {
  const operation = importLoadGuard.begin();
  importBuildGuard.invalidate();
  setMessage();
  selectedSheetData = null;
  importedAnimations = null;
  selectedSheetMeta = null;
  sheetGridChosen = false;
  sheetInfo.hidden = true;
  gridChoices.replaceChildren();
  updateSheetMap();
  if (creationMode === 'import') playAnimationPreview(null);
  if (!file) {
    setSheetStatus();
    return;
  }
  setSheetStatus('Checking your PNG…');
  try {
    validateUploadMetadata(file);
    const imageData = await readFile(file);
    if (!importLoadGuard.isCurrent(operation)) return;
    const details = await window.deskprite.validateImage(imageData);
    if (!importLoadGuard.isCurrent(operation)) return;
    if (!await imageHasTransparentPixels(imageData)) {
      throw new Error(ERROR_MESSAGES.noTransparentBackground);
    }
    if (!importLoadGuard.isCurrent(operation)) return;
    selectedSheetData = imageData;
    const hasGridChoices = renderSheetInfo(details.width, details.height);
    if (sheetGridChosen) await rebuildImportedAnimations();
    else if (hasGridChoices) {
      setSheetStatus('Choose one of the grid sizes above, then set each animation row, start column, and frame count.');
    }
  } catch (error) {
    if (!importLoadGuard.isCurrent(operation)) return;
    selectedSheetData = null;
    selectedSheetMeta = null;
    sheetGridChosen = false;
    sheetInfo.hidden = true;
    gridChoices.replaceChildren();
    updateSheetMap();
    if (creationMode === 'import') playAnimationPreview(null);
    setSheetStatus();
    setMessage(friendlyErrorMessage(error));
  }
}

function setCreationMode(nextMode) {
  if (creationMode === 'draw') saveActiveFrame();
  stopAnimationPreview();
  creationMode = nextMode;
  presetPanel.hidden = nextMode !== 'preset';
  importPanel.hidden = nextMode !== 'import';
  drawPanel.hidden = nextMode !== 'draw';
  for (const button of modeButtons) {
    const isActive = button.dataset.creationMode === nextMode;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  }
  if (nextMode === 'draw') {
    previewClip = activeClip;
    playAnimationPreview(drawingFrames);
  } else if (nextMode === 'preset') {
    if (presetAnimations?.idle?.[0]) playAnimationPreview(presetAnimations);
    else if (selectedPresetId) selectPreset(selectedPresetId, { updateName: false }).catch(showError);
    else selectPreset('sprout').catch(showError);
  } else if (importedAnimations?.idle?.[0]) {
    playAnimationPreview(importedAnimations);
  } else {
    playAnimationPreview(null);
  }
  updateOnionSkin();
  setMessage();
}

function updateOnionSkin() {
  const previous = activeFrame > 0 ? drawingFrames[activeClip][activeFrame - 1] : null;
  const show = creationMode === 'draw' && onionToggle.checked && Boolean(previous);
  onionSkin.hidden = !show;
  onionSkin.style.opacity = String(Number(onionOpacity.value) / 100);
  onionOpacityOutput.value = `${onionOpacity.value}%`;
  onionSkin.src = show ? previous : '';
}

function clearCanvas() {
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function saveActiveFrame() {
  drawingFrames[activeClip][activeFrame] = canvas.toDataURL('image/png');
}

async function loadActiveFrame() {
  const loadVersion = ++frameLoadVersion;
  clearCanvas();
  const data = drawingFrames[activeClip][activeFrame];
  if (!data) return;
  const source = await loadImage(data);
  if (loadVersion !== frameLoadVersion) return;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (creationMode === 'draw') playAnimationPreview(drawingFrames);
  updateOnionSkin();
}

function updateDrawingUI() {
  for (const button of clipButtons) {
    const isActive = button.dataset.clip === activeClip;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  }
  brushTool.classList.toggle('active', drawingTool === 'brush');
  eraserTool.classList.toggle('active', drawingTool === 'eraser');
  brushTool.setAttribute('aria-pressed', String(drawingTool === 'brush'));
  eraserTool.setAttribute('aria-pressed', String(drawingTool === 'eraser'));
  brushSizeOutput.value = `${brushSize.value} px`;
  drawFrameStatus.textContent = `${activeClip[0].toUpperCase()}${activeClip.slice(1)} · frame ${activeFrame + 1} of ${drawingFrames[activeClip].length}`;
  previousFrameButton.disabled = activeFrame === 0;
  nextFrameButton.disabled = activeFrame === drawingFrames[activeClip].length - 1;
  addFrameButton.disabled = drawingFrames[activeClip].length >= MAX_FRAMES_PER_CLIP;
  updateOnionSkin();

  drawFrameList.replaceChildren(...drawingFrames[activeClip].map((data, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'frame-thumb';
    button.classList.toggle('active', index === activeFrame);
    button.setAttribute('aria-label', `Select ${activeClip} frame ${index + 1}`);
    const thumbnail = document.createElement('img');
    thumbnail.src = data;
    thumbnail.alt = '';
    const label = document.createElement('span');
    label.textContent = String(index + 1);
    button.append(thumbnail, label);
    button.addEventListener('click', () => selectFrame(index));
    return button;
  }));
}

async function selectFrame(index) {
  saveActiveFrame();
  activeFrame = index;
  await loadActiveFrame();
  updateDrawingUI();
}

async function selectClip(clip) {
  saveActiveFrame();
  activeClip = clip;
  previewClip = clip;
  activeFrame = 0;
  await loadActiveFrame();
  updateDrawingUI();
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * canvas.width / bounds.width,
    y: (event.clientY - bounds.top) * canvas.height / bounds.height,
  };
}

function paintStroke(from, to) {
  context.save();
  context.globalCompositeOperation = drawingTool === 'eraser' ? 'destination-out' : 'source-over';
  context.strokeStyle = brushColor.value;
  context.fillStyle = brushColor.value;
  context.lineWidth = Number(brushSize.value);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (Math.hypot(to.x - from.x, to.y - from.y) < 0.4) {
    context.beginPath();
    context.arc(to.x, to.y, context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }
  context.restore();
}

function startDrawing(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  stopAnimationPreview();
  isDrawing = true;
  lastPoint = canvasPoint(event);
  canvas.setPointerCapture(event.pointerId);
  paintStroke(lastPoint, lastPoint);
}

function draw(event) {
  if (!isDrawing) return;
  const nextPoint = canvasPoint(event);
  paintStroke(lastPoint, nextPoint);
  lastPoint = nextPoint;
}

function stopDrawing(event) {
  if (!isDrawing) return;
  isDrawing = false;
  lastPoint = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  saveActiveFrame();
  playAnimationPreview(drawingFrames);
  updateDrawingUI();
}

async function exportedDrawingAnimations() {
  saveActiveFrame();
  const animations = { idle: [], walk: [] };
  for (const clip of ['idle', 'walk']) {
    for (const frame of drawingFrames[clip]) {
      if (await imageHasVisiblePixels(frame)) animations[clip].push(frame);
    }
  }
  validateAnimationFrameCounts(animations);
  return animations;
}

function button(label, className, handler) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = label;
  element.addEventListener('click', handler);
  return element;
}

function petBehavior(pet) {
  return normalizePetBehavior(pet?.behavior);
}

function behaviorSelect(labelText, choices, selectedValue) {
  const label = document.createElement('label');
  label.append(document.createTextNode(labelText));
  const select = document.createElement('select');
  for (const [value, text] of Object.entries(choices)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    select.append(option);
  }
  select.value = selectedValue;
  label.append(select);
  return { label, select };
}

function petEditor(pet, editButton) {
  const editor = document.createElement('form');
  editor.className = 'pet-card-editor';
  editor.id = `edit-${pet.id}`;
  editor.hidden = true;

  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Name';
  const name = document.createElement('input');
  name.type = 'text';
  name.maxLength = 36;
  name.value = pet.name;
  name.autocomplete = 'off';
  nameLabel.append(name);

  const sizeLabel = document.createElement('label');
  const sizeLabelText = document.createElement('span');
  sizeLabelText.textContent = 'Size ';
  const sizeValue = document.createElement('output');
  sizeValue.value = `${pet.size} px`;
  sizeLabelText.append(sizeValue);
  const size = document.createElement('input');
  size.type = 'range';
  size.min = '64';
  size.max = '192';
  size.value = String(pet.size);
  size.addEventListener('input', () => { sizeValue.value = `${size.value} px`; });
  sizeLabel.append(sizeLabelText, size);

  const motionLabel = document.createElement('label');
  motionLabel.textContent = 'Movement';
  const motion = document.createElement('select');
  const wanderOption = document.createElement('option');
  wanderOption.value = 'wander';
  wanderOption.textContent = 'Wanders around';
  const stillOption = document.createElement('option');
  stillOption.value = 'still';
  stillOption.textContent = 'Stays put';
  motion.append(wanderOption, stillOption);
  motion.value = pet.motion === 'still' ? 'still' : 'wander';
  motionLabel.append(motion);

  const savedBehavior = petBehavior(pet);
  const behaviorGroup = document.createElement('fieldset');
  behaviorGroup.className = 'pet-editor-behavior';
  const behaviorLegend = document.createElement('legend');
  behaviorLegend.textContent = 'Walking behavior';
  const frequencyField = behaviorSelect('Walking frequency', BEHAVIOR_LABELS.frequency, savedBehavior.frequency);
  const distanceField = behaviorSelect('Movement distance', BEHAVIOR_LABELS.distance, savedBehavior.distance);
  const areaField = behaviorSelect('Preferred screen area', BEHAVIOR_LABELS.area, savedBehavior.area);
  const monitorLabel = document.createElement('label');
  monitorLabel.className = 'pet-editor-monitor';
  const stayOnMonitor = document.createElement('input');
  stayOnMonitor.type = 'checkbox';
  stayOnMonitor.checked = savedBehavior.stayOnMonitor;
  const monitorText = document.createElement('span');
  monitorText.textContent = 'Stay on this monitor';
  monitorLabel.append(stayOnMonitor, monitorText);
  behaviorGroup.append(
    behaviorLegend,
    frequencyField.label,
    distanceField.label,
    areaField.label,
    monitorLabel,
  );

  const editorMessage = document.createElement('p');
  editorMessage.className = 'pet-editor-message';
  editorMessage.setAttribute('role', 'status');
  editorMessage.setAttribute('aria-live', 'polite');

  const editorActions = document.createElement('div');
  editorActions.className = 'pet-editor-actions';
  const saveButton = button('Save changes', 'save-button', () => undefined);
  saveButton.type = 'submit';
  const cancelButton = button('Cancel', 'cancel-button', () => {
    name.value = pet.name;
    size.value = String(pet.size);
    motion.value = pet.motion === 'still' ? 'still' : 'wander';
    frequencyField.select.value = savedBehavior.frequency;
    distanceField.select.value = savedBehavior.distance;
    areaField.select.value = savedBehavior.area;
    stayOnMonitor.checked = savedBehavior.stayOnMonitor;
    sizeValue.value = `${pet.size} px`;
    editorMessage.textContent = '';
    editor.hidden = true;
    editButton.setAttribute('aria-expanded', 'false');
    editButton.focus();
  });
  editorActions.append(saveButton, cancelButton);
  editor.append(nameLabel, sizeLabel, motionLabel, behaviorGroup, editorMessage, editorActions);

  editor.addEventListener('submit', async (event) => {
    event.preventDefault();
    saveButton.disabled = true;
    cancelButton.disabled = true;
    editorMessage.textContent = 'Saving changes…';
    try {
      const updated = await window.deskprite.updatePet(pet.id, {
        name: name.value,
        size: size.value,
        motion: motion.value,
        behavior: {
          frequency: frequencyField.select.value,
          distance: distanceField.select.value,
          area: areaField.select.value,
          stayOnMonitor: stayOnMonitor.checked,
        },
      });
      await refreshPets();
      setMessage(`${updated.name} was updated.`, true);
    } catch (error) {
      editorMessage.textContent = friendlyErrorMessage(error);
      saveButton.disabled = false;
      cancelButton.disabled = false;
    }
  });

  return editor;
}

function makePetCard(pet) {
  const card = document.createElement('article');
  card.className = 'pet-card';

  const imageArea = document.createElement('div');
  imageArea.className = 'pet-card-image';
  if (pet.imageData) {
    const image = document.createElement('img');
    image.src = pet.imageData;
    image.alt = `${pet.name} preview`;
    imageArea.append(image);
  } else {
    const missing = document.createElement('span');
    missing.className = 'missing-image';
    missing.textContent = '✦';
    imageArea.append(missing);
  }

  const body = document.createElement('div');
  body.className = 'pet-card-body';
  const title = document.createElement('h3');
  title.className = 'pet-card-title';
  title.textContent = pet.name;
  const status = document.createElement('span');
  status.className = `pet-card-status ${pet.shown ? 'is-shown' : 'is-hidden'}`;
  status.textContent = pet.shown ? 'On desktop' : 'Hidden';
  const meta = document.createElement('p');
  meta.className = 'pet-card-meta';
  meta.textContent = `${pet.size} px · ${pet.motion === 'still' ? 'Stays put' : 'Wanders'}`;
  const behavior = petBehavior(pet);
  const behaviorMeta = document.createElement('p');
  behaviorMeta.className = 'pet-card-behavior';
  behaviorMeta.textContent = [
    BEHAVIOR_LABELS.frequency[behavior.frequency],
    BEHAVIOR_LABELS.distance[behavior.distance],
    BEHAVIOR_LABELS.area[behavior.area],
    behavior.stayOnMonitor ? 'This monitor' : 'Any monitor',
  ].join(' · ');
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const visibilityLabel = pet.shown ? 'Hide' : 'Show';
  const visibilityButton = button(visibilityLabel, pet.shown ? 'hide-button' : 'show-button', async () => {
    visibilityButton.disabled = true;
    try {
      if (pet.shown) await window.deskprite.hidePet(pet.id);
      else await window.deskprite.launchPet(pet.id);
      await refreshPets();
    } catch (error) {
      showError(error);
      visibilityButton.disabled = false;
    }
  });
  visibilityButton.setAttribute('aria-label', `${visibilityLabel} ${pet.name}`);
  const editButton = button('Edit', 'edit-button', () => {
    const isOpening = editor.hidden;
    editor.hidden = !isOpening;
    editButton.setAttribute('aria-expanded', String(isOpening));
    if (isOpening) editor.querySelector('input')?.focus();
  });
  editButton.setAttribute('aria-expanded', 'false');
  editButton.setAttribute('aria-controls', `edit-${pet.id}`);
  const editor = petEditor(pet, editButton);
  actions.append(
    visibilityButton,
    editButton,
    button('Delete', 'delete-button', async () => {
      if (!window.confirm(`Delete ${pet.name}? This removes all of its saved sprite frames.`)) return;
      try {
        await window.deskprite.deletePet(pet.id);
        await refreshPets();
      } catch (error) {
        showError(error);
      }
    }),
  );
  body.append(title, status, meta, behaviorMeta, actions, editor);
  card.append(imageArea, body);
  return card;
}

function showError(error) {
  setMessage(friendlyErrorMessage(error));
}

async function refreshPets() {
  try {
    const pets = await window.deskprite.listPets();
    petList.replaceChildren(...pets.map(makePetCard));
    emptyState.hidden = pets.length > 0;
    buddyCount.textContent = `${pets.length} ${pets.length === 1 ? 'buddy' : 'buddies'}`;
  } catch (error) {
    showError(error);
  }
}

async function resetCreator() {
  form.reset();
  stopAnimationPreview();
  presetLoadVersion += 1;
  selectedPresetId = null;
  presetAnimations = null;
  presetStatus.textContent = 'Choose a starter to preview its animation.';
  for (const choice of presetChoices) {
    choice.classList.remove('active');
    choice.setAttribute('aria-pressed', 'false');
  }
  selectedSheetData = null;
  importedAnimations = null;
  selectedSheetMeta = null;
  sheetGridChosen = false;
  importLoadGuard.invalidate();
  importBuildGuard.invalidate();
  sheetInfo.hidden = true;
  gridChoices.replaceChildren();
  updateSheetMap();
  drawingFrames = { idle: [blankFrame()], walk: [blankFrame()] };
  activeClip = 'idle';
  previewClip = 'idle';
  activeFrame = 0;
  drawingTool = 'brush';
  previewPaused = false;
  sizeInput.value = '112';
  updatePreviewSize();
  brushSizeOutput.value = `${brushSize.value} px`;
  playAnimationPreview(null);
  setSheetStatus();
  clearCanvas();
  updateDrawingUI();
  updatePreviewName();
  if (creationMode === 'preset') await selectPreset('sprout');
  else playAnimationPreview(previewAnimationsForMode());
}

imageInput.addEventListener('change', () => useFile(imageInput.files?.[0]));
for (const eventName of ['dragenter', 'dragover']) {
  uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    uploadZone.classList.add('drag-over');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    uploadZone.classList.remove('drag-over');
  });
}
uploadZone.addEventListener('drop', (event) => useFile(event.dataTransfer?.files?.[0]));
for (const button of modeButtons) {
  button.addEventListener('click', () => setCreationMode(button.dataset.creationMode));
}
for (const choice of presetChoices) {
  choice.addEventListener('click', () => selectPreset(choice.dataset.presetId).catch(showError));
}
for (const input of Object.values(layoutInputs)) {
  input.addEventListener('change', async () => {
    if (!selectedSheetData) return;
    sheetGridChosen = true;
    try {
      const animations = await rebuildImportedAnimations();
      if (animations) setMessage();
    } catch (error) {
      importedAnimations = null;
      updateSheetMap();
      if (creationMode === 'import') playAnimationPreview(null);
      setSheetStatus('Check your row, column, and frame values.');
      setMessage(friendlyErrorMessage(error));
    }
  });
}
nameInput.addEventListener('input', updatePreviewName);
sizeInput.addEventListener('input', updatePreviewSize);
for (const button of previewClipButtons) {
  button.addEventListener('click', () => selectPreviewClip(button.dataset.previewClip));
}
previewMotionToggle.addEventListener('click', () => {
  previewPaused = !previewPaused;
  playAnimationPreview();
});
reducedMotion.addEventListener('change', () => playAnimationPreview());

brushSize.addEventListener('input', updateDrawingUI);
onionToggle.addEventListener('change', updateOnionSkin);
onionOpacity.addEventListener('input', updateOnionSkin);
brushTool.addEventListener('click', () => { drawingTool = 'brush'; updateDrawingUI(); });
eraserTool.addEventListener('click', () => { drawingTool = 'eraser'; updateDrawingUI(); });
clearFrameButton.addEventListener('click', () => {
  clearCanvas();
  saveActiveFrame();
  playAnimationPreview(drawingFrames);
  updateDrawingUI();
});
for (const clipButton of clipButtons) {
  clipButton.addEventListener('click', () => selectClip(clipButton.dataset.clip));
}
previousFrameButton.addEventListener('click', () => selectFrame(Math.max(0, activeFrame - 1)));
nextFrameButton.addEventListener('click', () => selectFrame(Math.min(drawingFrames[activeClip].length - 1, activeFrame + 1)));
addFrameButton.addEventListener('click', async () => {
  saveActiveFrame();
  if (drawingFrames[activeClip].length >= MAX_FRAMES_PER_CLIP) return;
  drawingFrames[activeClip].push(blankFrame());
  activeFrame = drawingFrames[activeClip].length - 1;
  await loadActiveFrame();
  updateDrawingUI();
});
deleteFrameButton.addEventListener('click', async () => {
  saveActiveFrame();
  if (drawingFrames[activeClip].length === 1) {
    clearCanvas();
    saveActiveFrame();
    playAnimationPreview(drawingFrames);
  } else {
    drawingFrames[activeClip].splice(activeFrame, 1);
    activeFrame = Math.min(activeFrame, drawingFrames[activeClip].length - 1);
    await loadActiveFrame();
  }
  updateDrawingUI();
});

canvas.addEventListener('pointerdown', startDrawing);
canvas.addEventListener('pointermove', draw);
canvas.addEventListener('pointerup', stopDrawing);
canvas.addEventListener('pointercancel', stopDrawing);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const requestedMode = creationMode;
  const requestedPresetId = selectedPresetId;
  const requestedName = nameInput.value;
  const requestedSize = sizeInput.value;
  const requestedMotion = form.elements.motion.value;
  const requestedBehavior = {
    frequency: behaviorInputs.frequency.value,
    distance: behaviorInputs.distance.value,
    area: behaviorInputs.area.value,
    stayOnMonitor: behaviorInputs.stayOnMonitor.checked,
  };
  setCreateButton(true);
  setMessage();
  try {
    let animations;
    if (requestedMode === 'preset') {
      if (!requestedPresetId) throw new Error('Choose a starter buddy first.');
      animations = presetAnimationCache.get(requestedPresetId) || await loadPresetAnimations(requestedPresetId);
    } else if (requestedMode === 'import') {
      animations = await rebuildImportedAnimations();
      if (!animations) throw new Error('Choose a transparent PNG sprite sheet first.');
    } else {
      animations = await exportedDrawingAnimations();
    }
    const createdPet = await window.deskprite.createPet({
      animations,
      name: requestedName,
      size: requestedSize,
      motion: requestedMotion,
      behavior: requestedBehavior,
    });
    await resetCreator();
    setMessage(
      createdPet.shown
        ? 'Your animated buddy is now on your desktop.'
        : 'Your buddy was saved. Select Show when you are ready to open it.',
      true,
    );
    await refreshPets();
  } catch (error) {
    showError(error);
  } finally {
    setCreateButton(false);
  }
});

window.deskprite.onPetsChanged(refreshPets);
updatePreviewName();
updatePreviewSize();
playAnimationPreview(null);
updateDrawingUI();
loadActiveFrame().catch(showError);
selectPreset('sprout').catch(showError);
refreshPets();
