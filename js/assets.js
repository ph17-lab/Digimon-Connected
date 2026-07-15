/*
 * assets.js — loads the real sprite frames (extracted from the reference
 * sheets) and HUD panels. Falls back to a procedurally drawn placeholder
 * (see sprites.js / hud.js) for anything that fails to load, so the game
 * always runs even if an asset is missing.
 */
'use strict';

const SPRITE_CHARACTERS = ['agumon', 'greymon', 'vmon', 'vdramon', 'guilmon', 'growlmon'];
const HUD_PARTS = ['hud_status', 'hud_minimap', 'hud_digivice'];
const ANIM_STATES = ['idle', 'walk', 'jump', 'fall', 'attack1', 'attack2', 'special'];

const Assets = {
  sprites: {},  // charId -> { idle:[Image,...], walk:[...], ... }
  hud: {},      // partName -> Image
  ready: false,

  async loadAll() {
    await Promise.all([
      ...SPRITE_CHARACTERS.map(id => this._loadCharacter(id)),
      ...HUD_PARTS.map(part => this._loadHudPart(part))
    ]);
    this.ready = true;
  },

  hasCharacter(id) { return !!this.sprites[id]; },

  getFrames(charId, state) {
    const c = this.sprites[charId];
    if (!c) return null;
    return c[state] || c.idle || null;
  },

  getHud(part) { return this.hud[part] || null; },

  async _loadCharacter(id) {
    try {
      const res = await fetch(`assets/sprites/${id}/manifest.json`);
      if (!res.ok) return;
      const manifest = await res.json();
      const entry = {};
      const jobs = [];
      for (const state of ANIM_STATES) {
        const files = manifest[state];
        if (!files || !files.length) continue;
        entry[state] = new Array(files.length);
        files.forEach((fn, i) => {
          jobs.push(this._loadImage(`assets/sprites/${id}/${fn}`).then(img => { entry[state][i] = img; }));
        });
      }
      await Promise.all(jobs);
      for (const state of ANIM_STATES) {
        if (entry[state]) entry[state] = entry[state].filter(Boolean);
      }
      this.sprites[id] = entry;
    } catch (e) { /* fall back to procedural rendering */ }
  },

  async _loadHudPart(part) {
    try {
      const img = await this._loadImage(`assets/hud/${part}.png`);
      this.hud[part] = img;
    } catch (e) { /* fall back to procedural HUD */ }
  },

  _loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }
};
