'use strict';

const { ERROR_MESSAGES, normalizePetSize } = require('./core');

function cleanPetName(value) {
  const name = String(value || '').replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
  return name.slice(0, 36) || 'New buddy';
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
  if (!Object.keys(updates).length) throw new Error(ERROR_MESSAGES.generic);
  return updates;
}

module.exports = Object.freeze({ cleanPetName, cleanPetUpdates });
