const { contextBridge, ipcRenderer } = require('electron');

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

const isPetWindow = new URL(window.location.href).pathname.endsWith('/pet.html');

if (isPetWindow) {
  contextBridge.exposeInMainWorld('deskprite', {
    pet: {
      get: (petId) => invoke('pet:get', petId),
      startDrag: (payload) => invoke('pet:drag-start', payload),
      moveDrag: (payload) => invoke('pet:drag-move', payload),
      endDrag: (petId) => invoke('pet:drag-end', petId),
      nudge: (petId) => invoke('pet:nudge', petId),
      onAnimationState: (callback) => {
        if (typeof callback !== 'function') return () => undefined;
        const listener = (_event, animation) => callback(animation);
        ipcRenderer.on('pet:animation-state', listener);
        return () => ipcRenderer.removeListener('pet:animation-state', listener);
      },
    },
  });
} else {
  contextBridge.exposeInMainWorld('deskprite', {
    listPets: () => invoke('pets:list'),
    validateImage: (imageData) => invoke('pets:validate-image', imageData),
    createPet: (input) => invoke('pets:create', input),
    updatePet: (petId, changes) => invoke('pets:update', petId, changes),
    launchPet: (petId) => invoke('pets:launch', petId),
    hidePet: (petId) => invoke('pets:hide', petId),
    deletePet: (petId) => invoke('pets:delete', petId),
    onPetsChanged: (callback) => {
      if (typeof callback !== 'function') return () => undefined;
      const listener = () => callback();
      ipcRenderer.on('pets:changed', listener);
      return () => ipcRenderer.removeListener('pets:changed', listener);
    },
  });
}
