/*
 * save.js — localStorage persistence: manual save, autosave, continue.
 */
'use strict';

const SAVE_KEY = 'digimonConnected.save.v1';
const SETTINGS_KEY = 'digimonConnected.settings.v1';

const SaveSystem = {
  lastSaveTime: null,

  hasSave() { return !!localStorage.getItem(SAVE_KEY); },

  save(state) {
    const payload = {
      version: 1,
      savedAt: Date.now(),
      character: state.character,
      evolved: state.evolved,
      unlockedEvolutions: state.unlockedEvolutions,
      levelId: state.levelId,
      checkpoint: state.checkpoint,
      hp: state.hp, maxHp: state.maxHp,
      sp: state.sp, maxSp: state.maxSp,
      level: state.level, exp: state.exp,
      digiSoul: state.digiSoul,
      inventory: state.inventory,
      collectedItemIds: state.collectedItemIds,
      defeatedBosses: state.defeatedBosses,
      unlockedSecrets: state.unlockedSecrets
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
      this.lastSaveTime = payload.savedAt;
      return true;
    } catch (e) {
      console.error('Save failed', e);
      return false;
    }
  },

  load() {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  },

  clear() { localStorage.removeItem(SAVE_KEY); },

  saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  },

  loadSettings() {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
};
