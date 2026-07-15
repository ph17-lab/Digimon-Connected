/*
 * hud.js — draws the persistent HUD (status panel, minimap, Digivice) using
 * the real extracted HUD art as a frame, with dynamic bars/text/portrait
 * drawn on top in the matching slots. Falls back to a drawn panel if the
 * HUD image failed to load.
 */
'use strict';

const HUD_LAYOUT = {
  status: {
    x: 14, y: 14, w: 274, h: 146,
    portrait: { x: 10, y: 8, w: 88, h: 88 },
    hpBar: { x: 145, y: 51, w: 120, h: 14 },
    spBar: { x: 145, y: 75, w: 120, h: 14 },
    lvl: { x: 16, y: 132 },
    xp: { x: 108, y: 132 }
  },
  minimap: {
    x: -14, y: 14, w: 314, h: 138, // x resolved from right edge at draw time
    zoneLabel: { x: 12, y: 26 },
    viewport: { x: 186, y: 8, w: 120, h: 122 }
  },
  digivice: {
    x: 14, y: -14, w: 274, h: 116, // y resolved from bottom edge at draw time
    buttons: [
      { key: 'evolution', x: 13, y: 48, w: 56, h: 56, color: '#e8a020' },
      { key: 'backpack', x: 80, y: 48, w: 56, h: 56, color: '#2a8fd8' },
      { key: 'save', x: 147, y: 48, w: 56, h: 56, color: '#8a4ad0' },
      { key: 'map', x: 214, y: 48, w: 56, h: 56, color: '#3ab04a' }
    ]
  }
};

const HUD = {
  canvas: null, ctx: null,
  onButton: null, // callback(key)
  _rects: {},

  init(canvas, onButton) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onButton = onButton;
    const handler = (evt) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
      const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
      const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
      const x = (clientX - rect.left) * scaleX, y = (clientY - rect.top) * scaleY;
      for (const key of Object.keys(this._rects)) {
        const r = this._rects[key];
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          if (this.onButton) this.onButton(key);
          evt.preventDefault();
          return;
        }
      }
    };
    canvas.addEventListener('click', handler);
    canvas.addEventListener('touchstart', handler, { passive: false });
  },

  draw(ctx, state) {
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._drawStatus(ctx, state);
    this._drawMinimap(ctx, state);
    this._drawDigivice(ctx, state);
    this._drawEvolveButton(ctx, state);
  },

  _drawStatus(ctx, state) {
    const L = HUD_LAYOUT.status;
    const img = Assets.getHud('hud_status');
    if (img) ctx.drawImage(img, L.x, L.y, L.w, L.h);
    else this._fallbackPanel(ctx, L.x, L.y, L.w, L.h);

    // portrait
    const p = L.portrait;
    const px = L.x + p.x, py = L.y + p.y;
    ctx.save();
    ctx.beginPath(); ctx.rect(px, py, p.w, p.h); ctx.clip();
    const def = CHARACTERS[state.charId];
    ctx.fillStyle = def.portraitBg || '#111';
    ctx.fillRect(px, py, p.w, p.h);
    const anim = getSpriteAnimator(state.charId);
    const savedState = anim.state, savedFrame = anim.frameIndex;
    anim.setState('idle');
    anim.frameIndex = 0;
    anim.draw(ctx, px + p.w / 2, py + p.h - 4, 1, 0.72);
    anim.state = savedState; anim.frameIndex = savedFrame;
    ctx.restore();

    // HP / SP bars
    this._drawBar(ctx, L.x + L.hpBar.x, L.y + L.hpBar.y, L.hpBar.w, L.hpBar.h, state.hp / state.maxHp, '#3ecb3e', '#0a3a0a');
    this._drawBar(ctx, L.x + L.spBar.x, L.y + L.spBar.y, L.spBar.w, L.spBar.h, state.sp / state.maxSp, '#38b6ff', '#0a2a4a');

    // mask the baked-in placeholder LVL/XP numbers before drawing the real ones
    ctx.fillStyle = '#0c1730';
    ctx.fillRect(L.x + 4, L.y + 112, L.w - 8, 30);

    ctx.fillStyle = '#cfe8ff';
    ctx.font = 'bold 15px monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(`LVL ${String(state.level).padStart(2, '0')}`, L.x + L.lvl.x, L.y + L.lvl.y);
    ctx.fillText(`XP ${state.exp}/${state.expToNext}`, L.x + L.xp.x, L.y + L.xp.y);
  },

  _drawBar(ctx, x, y, w, h, frac, color, bgColor) {
    frac = Math.max(0, Math.min(1, frac));
    ctx.fillStyle = bgColor;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * frac, h);
  },

  _drawMinimap(ctx, state) {
    const L = HUD_LAYOUT.minimap;
    const x0 = this.canvas.width - L.w - 14;
    const img = Assets.getHud('hud_minimap');
    if (img) ctx.drawImage(img, x0, L.y, L.w, L.h);
    else this._fallbackPanel(ctx, x0, L.y, L.w, L.h);

    // mask the baked-in placeholder zone label before drawing the real level name
    ctx.fillStyle = '#0c1730';
    ctx.fillRect(x0 + 4, L.y + 2, L.viewport.x - 8, 60);

    ctx.fillStyle = '#bfe8bf';
    ctx.font = 'bold 12px monospace';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(state.levelName || '', x0 + L.zoneLabel.x, L.y + L.zoneLabel.y);

    const vp = L.viewport;
    const mx = x0 + vp.x, my = L.y + vp.y;
    ctx.save();
    ctx.beginPath(); ctx.rect(mx, my, vp.w, vp.h); ctx.clip();
    ctx.fillStyle = 'rgba(10,30,20,0.55)';
    ctx.fillRect(mx, my, vp.w, vp.h);
    if (state.levelWidth) {
      const frac = (v) => v / state.levelWidth;
      for (const cp of state.checkpoints || []) {
        ctx.fillStyle = '#4fd0ff';
        ctx.fillRect(mx + frac(cp.x) * vp.w - 2, my + vp.h - 10, 4, 8);
      }
      if (state.bossPos) {
        ctx.fillStyle = '#ff4040';
        ctx.beginPath(); ctx.arc(mx + frac(state.bossPos.x) * vp.w, my + vp.h / 2, 4, 0, Math.PI * 2); ctx.fill();
      }
      if (state.doorPos) {
        ctx.fillStyle = '#ffd040';
        ctx.fillRect(mx + frac(state.doorPos.x) * vp.w - 2, my + vp.h - 14, 4, 12);
      }
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(mx + frac(state.playerX) * vp.w, my + vp.h - 10, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },

  _drawDigivice(ctx, state) {
    const L = HUD_LAYOUT.digivice;
    const y0 = this.canvas.height - L.h - 14;
    const img = Assets.getHud('hud_digivice');
    if (img) ctx.drawImage(img, L.x, y0, L.w, L.h);
    else this._fallbackPanel(ctx, L.x, y0, L.w, L.h);

    this._rects = {};
    for (const btn of L.buttons) {
      const bx = L.x + btn.x, by = y0 + btn.y;
      this._rects[btn.key] = { x: bx, y: by, w: btn.w, h: btn.h };
      if (!img) {
        ctx.fillStyle = btn.color;
        roundRectPath(ctx, bx, by, btn.w, btn.h, 8);
        ctx.fill();
      }
    }
  },

  _drawEvolveButton(ctx, state) {
    if (state.evolved || !state.canEvolve) return;
    const x = this.canvas.width / 2, y = this.canvas.height - 60;
    const pulse = 1 + Math.sin(performance.now() / 200) * 0.06;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = 'rgba(255,200,40,0.92)';
    roundRectPath(ctx, -90, -22, 180, 44, 12);
    ctx.fill();
    ctx.strokeStyle = '#3a2000'; ctx.lineWidth = 2;
    roundRectPath(ctx, -90, -22, 180, 44, 12);
    ctx.stroke();
    ctx.fillStyle = '#3a2000';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('DIGIEVOLUÇÃO PRONTA (C)', 0, 1);
    ctx.textAlign = 'left';
    ctx.restore();
  },

  _fallbackPanel(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(10,16,32,0.75)';
    roundRectPath(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = '#3a55a8'; ctx.lineWidth = 2;
    roundRectPath(ctx, x, y, w, h, 8);
    ctx.stroke();
  }
};
