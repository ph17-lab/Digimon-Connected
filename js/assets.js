/*
 * assets.js — loads the real sprite frames (extracted from the reference
 * sheets) and HUD panels. Falls back to a procedurally drawn placeholder
 * (see sprites.js / hud.js) for anything that fails to load, so the game
 * always runs even if an asset is missing.
 *
 * Two loading modes:
 *  - standalone (single-file build): window.EMBEDDED_MANIFESTS / EMBEDDED_IMAGES
 *    are inlined data (base64 data: URIs) baked in ahead of this script by
 *    build.py — no network requests at all, works from a plain file:// open.
 *  - dev mode (this repo's multi-file index.html): falls back to fetch()-ing
 *    assets/sprites/<id>/manifest.json and the referenced PNG files.
 */
'use strict';

const SPRITE_CHARACTERS = ['agumon', 'greymon', 'vmon', 'vdramon', 'guilmon', 'growlmon'];
const HUD_PARTS = ['hud_status', 'hud_minimap', 'hud_digivice'];
const ANIM_STATES = ['idle', 'walk', 'jump', 'fall', 'attack1', 'attack2', 'special', 'specialProj', 'specialImpact'];

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

  // no idle fallback — projectile/impact states must not draw the character
  getFramesStrict(charId, state) {
    const c = this.sprites[charId];
    if (!c || !c[state] || !c[state].length) return null;
    return c[state];
  },

  getHud(part) { return this.hud[part] || null; },

  async _loadCharacter(id) {
    try {
      const embedded = typeof EMBEDDED_MANIFESTS !== 'undefined' ? EMBEDDED_MANIFESTS[id] : null;
      const manifest = embedded || await fetch(`assets/sprites/${id}/manifest.json`).then(r => r.ok ? r.json() : null);
      if (!manifest) return;
      const entry = {};
      const jobs = [];
      for (const state of ANIM_STATES) {
        const files = manifest[state];
        if (!files || !files.length) continue;
        entry[state] = new Array(files.length);
        files.forEach((fn, i) => {
          const src = this._resolveSrc(`sprites/${id}/${fn}`, `assets/sprites/${id}/${fn}`);
          jobs.push(this._loadImage(src).then(img => { entry[state][i] = img; }));
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
      const src = this._resolveSrc(`hud/${part}.png`, `assets/hud/${part}.png`);
      const img = await this._loadImage(src);
      this.hud[part] = img;
    } catch (e) { /* fall back to procedural HUD */ }
  },

  // embedded (base64 data: URI) key first, plain relative path as dev fallback
  _resolveSrc(embeddedKey, path) {
    if (typeof EMBEDDED_IMAGES !== 'undefined' && EMBEDDED_IMAGES[embeddedKey]) return EMBEDDED_IMAGES[embeddedKey];
    return path;
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
