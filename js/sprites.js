/*
 * sprites.js — animates and draws a Digimon using the real extracted sprite
 * frames (via Assets). If a character/state has no loaded frames yet, falls
 * back to a simple procedural silhouette so the game never shows a blank
 * character.
 */
'use strict';

const STATE_FRAME_MS = {
  idle: 220, walk: 90, jump: 90, fall: 120,
  attack1: 55, attack2: 55, special: 70
};
const LOOPING_STATES = new Set(['idle', 'walk']);

class DigimonSprite {
  constructor(charId) {
    this.charId = charId;
    this.state = 'idle';
    this.frameIndex = 0;
    this.frameTimer = 0;
    this.frameMsOverride = null;
    this.finished = false;
  }

  setState(state, { force = false, frameMs = null } = {}) {
    if (this.state === state && !force) return;
    this.state = state;
    this.frameIndex = 0;
    this.frameTimer = 0;
    this.frameMsOverride = frameMs;
    this.finished = false;
  }

  update(dt) {
    const frames = Assets.getFrames(this.charId, this.state);
    const count = frames ? frames.length : 4;
    const perFrame = this.frameMsOverride || STATE_FRAME_MS[this.state] || 120;
    this.frameTimer += dt;
    if (this.frameTimer >= perFrame) {
      this.frameTimer -= perFrame;
      this.frameIndex++;
      if (this.frameIndex >= count) {
        if (LOOPING_STATES.has(this.state)) {
          this.frameIndex = 0;
        } else {
          this.frameIndex = count - 1;
          this.finished = true;
        }
      }
    }
  }

  isFinished() { return this.finished; }

  // draws anchored at bottom-center (x, groundY), flipped if facing === -1
  draw(ctx, x, groundY, facing, scale = 1, opts = {}) {
    const frames = Assets.getFrames(this.charId, this.state);
    ctx.save();
    if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
    if (opts.flashWhite) ctx.filter = 'brightness(3) saturate(0)';
    else if (opts.hitFlash) ctx.filter = 'brightness(2) saturate(2) hue-rotate(-20deg)';
    else if (opts.glow) ctx.filter = `drop-shadow(0 0 ${opts.glow}px #fff)`;

    if (frames && frames.length) {
      const img = frames[Math.min(this.frameIndex, frames.length - 1)];
      const targetH = 108 * scale;
      const ratio = img.width / img.height;
      const targetW = targetH * ratio;
      ctx.translate(x, groundY);
      ctx.scale(facing, 1);
      ctx.drawImage(img, -targetW / 2, -targetH, targetW, targetH);
    } else {
      drawProceduralDigimon(ctx, this.charId, this.state, x, groundY, facing, scale, this.frameIndex);
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Procedural fallback (used only if real frames failed to load)
// ---------------------------------------------------------------------------
function drawProceduralDigimon(ctx, charId, state, x, groundY, facing, scale, frameIndex) {
  const def = CHARACTERS[charId];
  if (!def) return;
  const color = def.color || '#cccccc';
  const w = 60 * scale, h = 100 * scale;
  const bob = state === 'walk' ? Math.sin(frameIndex) * 4 : 0;
  ctx.translate(x, groundY);
  ctx.scale(facing, 1);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, -h / 2 + bob, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = def.accent || '#000';
  ctx.beginPath();
  ctx.ellipse(w * 0.12, -h * 0.65 + bob, w * 0.08, w * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
}

const SpriteCache = { instances: {} };
function getSpriteAnimator(charId) {
  if (!SpriteCache.instances[charId]) SpriteCache.instances[charId] = new DigimonSprite(charId);
  return SpriteCache.instances[charId];
}
