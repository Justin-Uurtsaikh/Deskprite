'use strict';

function createPetVisibilityState() {
  const currentByPet = new Map();
  const operationNodes = new WeakMap();

  function begin(petId, shown) {
    const node = {
      petId,
      shown: Boolean(shown),
      previous: currentByPet.get(petId),
      rolledBack: false,
    };
    const operation = Object.freeze({});

    operationNodes.set(operation, node);
    currentByPet.set(petId, node);
    return operation;
  }

  function get(petId, fallback) {
    const current = currentByPet.get(petId);
    return current ? current.shown : Boolean(fallback);
  }

  function beginMany(petIds, shown, operations = new Map()) {
    for (const petId of petIds) {
      if (!operations.has(petId)) operations.set(petId, begin(petId, shown));
    }
    return operations;
  }

  function rollback(operation) {
    const node = operation && operationNodes.get(operation);
    if (!node || node.rolledBack) return false;

    node.rolledBack = true;
    if (currentByPet.get(node.petId) !== node) return false;

    let previous = node.previous;
    while (previous?.rolledBack) previous = previous.previous;
    if (previous) currentByPet.set(node.petId, previous);
    else currentByPet.delete(node.petId);
    return true;
  }

  function deletePet(petId) {
    return currentByPet.delete(petId);
  }

  return Object.freeze({
    begin,
    beginMany,
    get,
    rollback,
    delete: deletePet,
  });
}

module.exports = Object.freeze({ createPetVisibilityState });
