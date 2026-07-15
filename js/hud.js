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

  scale: 1,
  W: 960,   // logical HUD design-space size (canvas size divided by scale)
  H: 540,

  draw(ctx, state) {
    const cw = this.canvas.width, ch = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    // shrink the whole HUD on screens narrower than the 960x540 design space
    // so the status panel, minimap and Digivice never collide
    const s = this.scale = Math.min(1, Math.max(0.55, Math.min(cw / 960, ch / 540)));
    this.W = cw / s;
    this.H = ch / s;
    this._isMobile = typeof Settings !== 'undefined' && Settings.platform === 'mobile';
    ctx.save();
    ctx.scale(s, s);
    this._drawStatus(ctx, state);
    this._drawMinimap(ctx, state);
    this._drawDigivice(ctx, state);
    this._drawEvolveButton(ctx, state);
    ctx.restore();

    // pulse the mobile DNA button whenever digivolution is ready
    const evolveBtn = document.getElementById('btn-evolve');
    if (evolveBtn) evolveBtn.classList.toggle('ready', !!state.canEvolve && !state.evolved);
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
    const anim = getUiAnimator(state.charId);
    anim.setState('idle');
    anim.update(16); // HUD draws once per game frame, so ~16ms per tick
    anim.draw(ctx, px + p.w / 2, py + p.h - 4, 1, 0.72);
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
    // on mobile, leave room at the far right for the pause touch button
    const x0 = this.W - L.w - (this._isMobile ? 90 : 14);
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
    // on mobile the bottom-left corner belongs to the touch d-pad, so the
    // Digivice moves to the bottom-center gap between the two touch clusters
    const x0 = this._isMobile ? (this.W - L.w) / 2 : L.x;
    const y0 = this.H - L.h - 14;
    const img = Assets.getHud('hud_digivice');
    if (img) ctx.drawImage(img, x0, y0, L.w, L.h);
    else this._fallbackPanel(ctx, x0, y0, L.w, L.h);

    const s = this.scale;
    this._rects = {};
    for (const btn of L.buttons) {
      const bx = x0 + btn.x, by = y0 + btn.y;
      // stored in device pixels so the click handler needs no conversion
      this._rects[btn.key] = { x: bx * s, y: by * s, w: btn.w * s, h: btn.h * s };
      if (!img) {
        ctx.fillStyle = btn.color;
        roundRectPath(ctx, bx, by, btn.w, btn.h, 8);
        ctx.fill();
      }
    }
  },

  _drawEvolveButton(ctx, state) {
    if (state.evolved || !state.canEvolve) return;
    if (this._isMobile) return; // mobile uses the pulsing DNA touch button instead
    const x = this.W / 2, y = this.H - 60;
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
