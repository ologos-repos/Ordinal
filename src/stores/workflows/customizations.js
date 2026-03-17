import { writable, get } from 'svelte/store';

// Store for container customizations (colors and labels)
export const containerCustomizations = writable(new Map());

// Container customization actions
export const containerActions = {
  /**
   * @param {string} containerId
   * @param {string} color
   */
  setCustomColor: (containerId, color) => {
    containerCustomizations.update((store) => {
      const newStore = new Map(store);
      const existing = newStore.get(containerId) || {};
      newStore.set(containerId, { ...existing, customColor: color });
      return newStore;
    });
  },

  /**
   * @param {string} containerId
   * @param {string} label
   */
  setCustomLabel: (containerId, label) => {
    containerCustomizations.update((store) => {
      const newStore = new Map(store);
      const existing = newStore.get(containerId) || {};
      newStore.set(containerId, { ...existing, customLabel: label });
      return newStore;
    });
  },

  /**
   * @param {string} containerId
   */
  clearCustomColor: (containerId) => {
    containerCustomizations.update((store) => {
      const newStore = new Map(store);
      const existing = newStore.get(containerId);
      if (existing) {
        const { customColor, ...rest } = existing;
        if (Object.keys(rest).length > 0) {
          newStore.set(containerId, rest);
        } else {
          newStore.delete(containerId);
        }
      }
      return newStore;
    });
  },

  /**
   * @param {string} containerId
   */
  clearCustomLabel: (containerId) => {
    containerCustomizations.update((store) => {
      const newStore = new Map(store);
      const existing = newStore.get(containerId);
      if (existing) {
        const { customLabel, ...rest } = existing;
        if (Object.keys(rest).length > 0) {
          newStore.set(containerId, rest);
        } else {
          newStore.delete(containerId);
        }
      }
      return newStore;
    });
  },

  /**
   * @param {string} containerId
   */
  getCustomization: (containerId) => {
    const store = get(containerCustomizations);
    return store.get(containerId) || {};
  },

  /**
   * Store a YAML position hint for a container or node.
   * Used by the paste pipeline to persist position hints from .ologic YAML
   * so the organize context builders can apply them after layout.
   * @param {string} containerId
   * @param {string} hint - e.g. "below ingestion" or "right-of analytics"
   */
  setPositionHint: (containerId, hint) => {
    containerCustomizations.update((store) => {
      const newStore = new Map(store);
      const existing = newStore.get(containerId) || {};
      newStore.set(containerId, { ...existing, positionHint: hint });
      return newStore;
    });
  },

  /**
   * Clear the position hint for a container or node.
   * @param {string} containerId
   */
  clearPositionHint: (containerId) => {
    containerCustomizations.update((store) => {
      const newStore = new Map(store);
      const existing = newStore.get(containerId);
      if (existing) {
        const { positionHint, ...rest } = existing;
        if (Object.keys(rest).length > 0) {
          newStore.set(containerId, rest);
        } else {
          newStore.delete(containerId);
        }
      }
      return newStore;
    });
  },
};
