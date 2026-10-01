const {
  animationFramesForState,
  animationFrameAt,
  normalizePetBehavior,
  wanderDelayForBehavior,
} = window.DeskpriteCore;

const petId = new URLSearchParams(window.location.search).get('petId');
const stage = document.querySelector('#stage');
const shell = document.querySelector('#pet-shell');
const image = document.querySelector('#pet-image');

let pet = null;
let pointerId = null;
let latestPoint = null;
let animationFrame = null;
let wanderingTimer = null;
let removeAnimationListener = () => undefined;
let dragReady = false;
let dragStartTask = Promise.resolve(false);
let dragIsEnding = false;
let animationState = 'idle';
let animationIndex = 0;
let animationTimer = null;
let animationClips = { idle: [], walk: [] };
let wanderingStopped = false;

function respectsReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function stableNumber(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function wanderDelay(initial, retryAfter = 0) {
  const phase = stableNumber(pet?.id || petId);
  if (retryAfter > 0) {
    return retryAfter + 180 + (phase % 520) + Math.round(Math.random() * 450);
  }
  const frequency = normalizePetBehavior(pet?.behavior).frequency;
  return wanderDelayForBehavior(frequency, initial, phase, Math.random());
}

function clearFrameTimer() {
  if (animationTimer) window.clearInterval(animationTimer);
  animationTimer = null;
}

function framesForState(state) {
  return animationFramesForState(animationClips, state);
}

function showFrame(index = 0) {
  const selected = animationFrameAt(animationClips, animationState, index);
  if (!selected.frame) return;
  animationIndex = selected.index;
  image.src = selected.frame;
}

function playFrames(reset = true) {
  clearFrameTimer();
  if (reset) showFrame(0);
  const frames = framesForState(animationState);
  if (respectsReducedMotion() || frames.length < 2) return;
  const speed = animationState === 'walk' ? 135 : 420;
  animationTimer = window.setInterval(() => showFrame(animationIndex + 1), speed);
}

function applyAnimation(animation) {
  const state = animation?.state === 'walk' ? 'walk' : 'idle';
  shell.classList.toggle('walking', state === 'walk');
  if (animation?.direction) shell.classList.toggle('facing-left', animation.direction === 'left');
  if (state !== animationState) {
    animationState = state;
    playFrames(true);
  }
}

function queueDrag() {
  if (animationFrame || !latestPoint || !pet || !dragReady || dragIsEnding) return;
  animationFrame = window.requestAnimationFrame(() => {
    animationFrame = null;
    window.deskprite.pet.moveDrag({ petId: pet.id, ...latestPoint }).catch(() => undefined);
  });
}

function beginDrag(event) {
  if (!pet || event.button !== 0 || pointerId !== null) return;
  pointerId = event.pointerId;
  latestPoint = { screenX: event.screenX, screenY: event.screenY };
  dragReady = false;
  dragIsEnding = false;
  shell.classList.add('walking');
  stage.classList.add('dragging');
  stage.setPointerCapture(pointerId);
  const activePointerId = pointerId;
  dragStartTask = window.deskprite.pet.startDrag({ petId: pet.id, ...latestPoint })
    .then(() => {
      if (pointerId === activePointerId && !dragIsEnding) {
        dragReady = true;
        queueDrag();
      }
      return true;
    })
    .catch(() => false);
}

function moveDrag(event) {
  if (event.pointerId !== pointerId) return;
  if (latestPoint && event.screenX !== latestPoint.screenX) {
    shell.classList.toggle('facing-left', event.screenX < latestPoint.screenX);
  }
  latestPoint = { screenX: event.screenX, screenY: event.screenY };
  queueDrag();
}

async function endDrag(event) {
  if (event.pointerId !== pointerId) return;
  const activePointerId = pointerId;
  const finalPoint = { screenX: event.screenX, screenY: event.screenY };
  dragIsEnding = true;
  latestPoint = finalPoint;
  if (animationFrame) {
    window.cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
  if (stage.hasPointerCapture(activePointerId)) stage.releasePointerCapture(activePointerId);
  stage.classList.remove('dragging');
  try {
    const started = await dragStartTask;
    if (started && pet && pointerId === activePointerId) {
      await window.deskprite.pet.moveDrag({ petId: pet.id, ...finalPoint });
      await window.deskprite.pet.endDrag(pet.id);
    }
  } catch {
    // The next movement cycle will restore the idle state if the pet window closes mid-drag.
  } finally {
    if (pointerId === activePointerId) {
      pointerId = null;
      latestPoint = null;
      dragReady = false;
      dragIsEnding = false;
      applyAnimation({ state: 'idle' });
    }
  }
}

function scheduleWander() {
  if (!pet || pet.motion === 'still' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const queueWander = (initial = false, retryAfter = 0) => {
    if (wanderingStopped) return;
    wanderingTimer = window.setTimeout(async () => {
      if (wanderingStopped) return;
      let result = null;
      if (pointerId === null) {
        result = await window.deskprite.pet.nudge(pet.id).catch(() => null);
      }
      if (wanderingStopped) return;
      const nextRetry = result && result.started === false ? Number(result.retryAfter) || 0 : 0;
      queueWander(false, nextRetry);
    }, wanderDelay(initial, retryAfter));
  };
  queueWander(true);
}

async function loadPet() {
  if (!petId) return;
  try {
    pet = await window.deskprite.pet.get(petId);
    document.documentElement.style.setProperty('--pet-size', `${pet.size}px`);
    const idle = Array.isArray(pet.animations?.idle) && pet.animations.idle.length
      ? pet.animations.idle
      : [pet.imageData].filter(Boolean);
    const walk = Array.isArray(pet.animations?.walk) && pet.animations.walk.length
      ? pet.animations.walk
      : idle;
    animationClips = { idle, walk };
    playFrames(true);
    image.alt = pet.name;
    stage.setAttribute('aria-label', `${pet.name}. Drag to move it.`);
    removeAnimationListener = window.deskprite.pet.onAnimationState(applyAnimation);
    scheduleWander();
  } catch {
    window.close();
  }
}

stage.addEventListener('pointerdown', beginDrag);
stage.addEventListener('pointermove', moveDrag);
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
window.addEventListener('beforeunload', () => {
  wanderingStopped = true;
  if (wanderingTimer) window.clearTimeout(wanderingTimer);
  clearFrameTimer();
  removeAnimationListener();
});

loadPet();
