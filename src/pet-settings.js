'use strict';

const {
  ERROR_MESSAGES,
  PET_BEHAVIOR_OPTIONS,
  normalizePetBehavior,
  normalizePetSize,
} = require('./core');

function cleanPetName(value) {
  const name = String(value || '').replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
  return name.slice(0, 36) || 'New buddy';
}

function mergePetBehavior(current, updates) {
  return normalizePetBehavior({
    ...normalizePetBehavior(current),
    ...(updates || {}),
  });
}

function cleanPetUpdates(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(ERROR_MESSAGES.generic);
  }

  const updates = {};
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(value, key);
  if (hasOwn('name')) {
    if (typeof value.name !== 'string') throw new Error(ERROR_MESSAGES.generic);
    updates.name = cleanPetName(value.name);
  }
  if (hasOwn('size')) {
    const size = typeof value.size === 'string' && value.size.trim()
      ? Number(value.size)
      : value.size;
    if (typeof size !== 'number' || !Number.isFinite(size)) throw new Error(ERROR_MESSAGES.generic);
    updates.size = normalizePetSize(size);
  }
  if (hasOwn('motion')) {
    if (value.motion !== 'still' && value.motion !== 'wander') {
      throw new Error(ERROR_MESSAGES.generic);
    }
    updates.motion = value.motion;
  }
  if (hasOwn('behavior')) {
    const behavior = value.behavior;
    if (!behavior || typeof behavior !== 'object' || Array.isArray(behavior)) {
      throw new Error(ERROR_MESSAGES.generic);
    }
    const allowedKeys = ['frequency', 'distance', 'area', 'stayOnMonitor'];
    const suppliedKeys = Object.keys(behavior);
    if (!suppliedKeys.length || suppliedKeys.some((key) => !allowedKeys.includes(key))) {
      throw new Error(ERROR_MESSAGES.generic);
    }
    const cleanedBehavior = {};
    if (Object.prototype.hasOwnProperty.call(behavior, 'frequency')) {
      if (!PET_BEHAVIOR_OPTIONS.frequency.includes(behavior.frequency)) {
        throw new Error(ERROR_MESSAGES.generic);
      }
      cleanedBehavior.frequency = behavior.frequency;
    }
    if (Object.prototype.hasOwnProperty.call(behavior, 'distance')) {
      if (!PET_BEHAVIOR_OPTIONS.distance.includes(behavior.distance)) {
        throw new Error(ERROR_MESSAGES.generic);
      }
      cleanedBehavior.distance = behavior.distance;
    }
    if (Object.prototype.hasOwnProperty.call(behavior, 'area')) {
      if (!PET_BEHAVIOR_OPTIONS.area.includes(behavior.area)) {
        throw new Error(ERROR_MESSAGES.generic);
      }
      cleanedBehavior.area = behavior.area;
    }
    if (Object.prototype.hasOwnProperty.call(behavior, 'stayOnMonitor')) {
      if (typeof behavior.stayOnMonitor !== 'boolean') throw new Error(ERROR_MESSAGES.generic);
      cleanedBehavior.stayOnMonitor = behavior.stayOnMonitor;
    }
    updates.behavior = cleanedBehavior;
  }
  if (!Object.keys(updates).length) throw new Error(ERROR_MESSAGES.generic);
  return updates;
}

module.exports = Object.freeze({ cleanPetName, cleanPetUpdates, mergePetBehavior });
