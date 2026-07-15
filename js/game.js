/*
 * game.js — state machine + orchestration: level loading, camera, physics
 * resolution between player/enemies/level geometry, rendering, and the
 * overall run loop. UI screens (menus, pause, panels) are driven by ui.js;
 * this module owns everything that happens on the game canvas itself.
 */
'use strict';

const APP_STATE = {
  BOOT: 'boot', PLATFORM_SELECT: 'platform_select', MAIN_MENU: 'main_menu',
  CHAR_SELECT: 'char_select', SETTINGS: 'settings', CREDITS: 'credits',
  PLAYING: 'playing', PAUSED: 'paused', GAME_OVER: 'game_over', VICTORY: 'victory'
};

// deterministic pseudo-random in [0,1) — scenery decoration stays put frame to frame
function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// per-theme background art configuration (parallax silhouettes + accents)
const THEME_BG = {
  forest:  { far: '#33633f', near: '#224730', style: 'trees',     top: '#57a844', cloud: 'rgba(255,255,255,0.5)' },
  city:    { far: '#28305a', near: '#181f40', style: 'buildings', top: '#5fd3ff', cloud: 'rgba(170,190,230,0.28)' },
  volcano: { far: '#5c2a1c', near: '#3a1810', style: 'peaks',     top: '#ff7a30', cloud: 'rgba(60,30,25,0.55)' },
  castle:  { far: '#332650', near: '#201736', style: 'towers',    top: '#8a6ad8', cloud: 'rgba(90,70,130,0.35)' }
};

const Game = {
  canvas: null, ctx: null,
  appState: APP_STATE.BOOT,
  player: null,
  level: null,
  levelIndex: 0,
  enemies: [],
  boss: null,
  projectiles: [],   // player special-attack projectiles
  particles: new ParticleSystem(),
  shake: new ScreenShake(),
  cameraX: 0,
  checkpointIndex: 0,
  activeItems: [],
  secretUnlockedThisLevel: false,
  doorOpen: false,
  levelComplete: false,
  lastAutosave: 0,
  _lastTime: 0,
  _rafId: null,
  transientMessage: null,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  },

  // re-derive the internal canvas resolution from the real screen aspect
  // ratio: height is fixed at the 540px design space (level geometry depends
  // on it), width follows the device so nothing gets letterboxed or squeezed
  resize() {
    const vw = Math.max(1, window.innerWidth);
    const vh = Math.max(1, window.innerHeight);
    const aspect = Math.min(Math.max(vw / vh, 0.5), 3.2);
    const H = 540;
    const W = Math.round(H * aspect);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const hudCanvas = HUD.canvas || document.getElementById('hud-canvas');
    if (hudCanvas && (hudCanvas.width !== W || hudCanvas.height !== H)) {
      hudCanvas.width = W;
      hudCanvas.height = H;
    }
  },

  // -------------------------------------------------------------- lifecycle
  startNewGame(rookieId) {
    this.player = new Player(rookieId, 0, 0);
    this.levelIndex = 0;
    this.player.unlockedEvolutions = new Set([rookieId, CHARACTERS[rookieId].evolvesTo]);
    this.loadLevel(LEVELS[0].id, 0);
    this.appState = APP_STATE.PLAYING;
  },

  loadGameFromSave(save) {
    const p = new Player(save.character, 0, 0);
    p.evolved = false;
    p.unlockedEvolutions = new Set([save.character, CHARACTERS[save.character].evolvesTo]);
    p.level = save.level; p.exp = save.exp;
    p.maxHp = save.maxHp; p.hp = save.hp;
    p.maxSp = save.maxSp; p.sp = save.sp;
    p.digiSoul = save.digiSoul || 0;
    p.inventory = save.inventory || [];
    p.collectedItemIds = new Set(save.collectedItemIds || []);
    p.defeatedBosses = new Set(save.defeatedBosses || []);
    p.unlockedSecrets = new Set(save.unlockedSecrets || []);
    this.player = p;
    const idx = Math.max(0, LEVELS.findIndex(l => l.id === save.levelId));
    this.levelIndex = idx;
    this.loadLevel(save.levelId, save.checkpoint || 0);
    this.appState = APP_STATE.PLAYING;
  },

  loadLevel(levelId, checkpointIndex) {
    const level = LEVELS.find(l => l.id === levelId);
    this.level = level;
    this.checkpointIndex = checkpointIndex || 0;
    const cp = level.checkpoints[this.checkpointIndex] || { x: 80, y: level.groundY };
    this.player.x = cp.x; this.player.y = cp.y;
    this.player.vx = 0; this.player.vy = 0;
    this.player.dead = false;
    this.player.hp = this.player.maxHp;
    this.enemies = level.enemies
      .filter(e => e.x > cp.x - 40)
      .map(e => new Enemy(e.type, e.x, e.y));
    this.boss = null;
    this._bossSpawn = level.boss;
    this.activeItems = level.items
      .filter(it => !this.player.collectedItemIds.has(`${level.id}:${it.id}:${it.x}`))
      .map(it => ({ ...it, key: `${level.id}:${it.id}:${it.x}` }));
    this.secretUnlockedThisLevel = this.player.unlockedSecrets.has(`${level.id}:secret`);
    this.doorOpen = false;
    this.levelComplete = false;
    this.projectiles = [];
    this.particles.clear();
    UI.clearToast();
    this.cameraX = Math.max(0, Math.min(cp.x - this.canvas.width / 2, level.width - this.canvas.width));
    AudioSys.playTheme(level.ambient);
  },

  respawnAtCheckpoint() {
    this.loadLevel(this.level.id, this.checkpointIndex);
    this.appState = APP_STATE.PLAYING;
  },

  // ------------------------------------------------------------------ tick
  start() {
    this._lastTime = performance.now();
    const loop = (t) => {
      const dt = Math.min(40, t - this._lastTime);
      this._lastTime = t;
      Input.update();
      this.update(dt);
      this.render();
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  },

  update(dt) {
    if (this.appState !== APP_STATE.PLAYING) return;
    if (Input.pressed('pause')) { UI.openPause(); return; }

    const solids = this.level.platforms;
    this.player.handleInput(Input);
    if (Input.pressed('evolve') && this.player.canEvolve()) {
      this.player.evolve(this.particles, this.shake);
    }
    this.player.update(dt, solids, this.particles, this.shake);

    // spawn boss lazily once player gets near
    if (!this.boss && this._bossSpawn && this.player.x > this._bossSpawn.x - 500) {
      this.boss = new Boss(this._bossSpawn.type, this._bossSpawn.x, this._bossSpawn.y);
    }

    for (const en of this.enemies) en.update(dt, solids, this.player, this.particles);
    if (this.boss) this.boss.update(dt, solids, this.player, this.particles);

    // launch any special projectile the player queued this frame
    if (this.player.pendingProjectile) {
      this._spawnProjectile(this.player.pendingProjectile);
      this.player.pendingProjectile = null;
    }
    this._updateProjectiles(dt);

    this._resolvePlayerAttacks();
    this._resolveHazards();
    this._resolvePickups();
    this._resolveCheckpoints();
    this._resolveSecret();
    this._resolveDoor();

    this.enemies = this.enemies.filter(e => !(e.dead && e.deathTimer <= 0));
    this.particles.update(dt);
    this.shake.update(dt);

    this.cameraX = Math.max(0, Math.min(this.player.x - this.canvas.width / 2, this.level.width - this.canvas.width));

    if (this.player.dead && this.appState === APP_STATE.PLAYING) {
      AudioSys.sfx('gameover');
      this.appState = APP_STATE.GAME_OVER;
      UI.showGameOver(false);
    }

    this.lastAutosave += dt;
    if (this.lastAutosave > 20000) { this.lastAutosave = 0; this._autosave(); }
  },

  _hitEnemy(en, dmg, knockDir) {
    en.takeDamage(dmg, knockDir, this.particles);
    this.shake.trigger(4, 100);
    if (en.dead) {
      this.player.gainExp(en.def.expReward);
      this.player.gainDigiSoul(en.def.soulReward || 10);
      if (en.isBoss) this.player.defeatedBosses.add(this.level.id);
    }
  },

  _resolvePlayerAttacks() {
    const box = this.player.getAttackHitbox();
    if (!box) return;
    const dmg = this.player.getAttackDamage();
    const targets = this.boss ? [...this.enemies, this.boss] : this.enemies;
    for (const en of targets) {
      if (en.dead || this.player.attackHitEnemies.has(en)) continue;
      if (rectsOverlap(box, getAABB(en))) {
        this.player.attackHitEnemies.add(en);
        this._hitEnemy(en, dmg, this.player.facing);
      }
    }
  },

  // ------------------------------------------------- special projectiles
  _spawnProjectile(spec) {
    this.projectiles.push({
      ...spec,
      age: 0, frameTimer: 0, frameIndex: 0,
      state: 'fly', impactTimer: 0
    });
  },

  _updateProjectiles(dt) {
    const dtS = dt / 1000;
    const targets = this.boss ? [...this.enemies, this.boss] : this.enemies;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.state === 'impact') {
        p.impactTimer += dt;
        if (p.impactTimer > 280) this.projectiles.splice(i, 1);
        continue;
      }
      p.age += dt;
      p.frameTimer += dt;
      p.x += p.vx * dtS;
      const frames = Assets.getFramesStrict(p.charId, 'specialProj');
      if (frames && frames.length && p.frameTimer > 90) {
        p.frameTimer = 0;
        p.frameIndex = (p.frameIndex + 1) % frames.length;
      }
      const img = frames && frames.length ? frames[p.frameIndex] : null;
      // collision box tighter than the drawn sprite — the glow shouldn't hit
      const ph = (img ? img.height : 50) * 0.60 * (p.scale || 1);
      const pw = (img ? img.width : 50) * 0.70 * (p.scale || 1);
      const box = { x: p.x - pw / 2, y: p.y - ph / 2, w: pw, h: ph };

      let hit = false;
      for (const en of targets) {
        if (en.dead) continue;
        if (rectsOverlap(box, getAABB(en))) {
          this._hitEnemy(en, p.damage, p.vx > 0 ? 1 : -1);
          hit = true;
          break;
        }
      }
      if (!hit) {
        for (const r of this.level.platforms) {
          if (rectsOverlap(box, r)) { hit = true; break; }
        }
      }
      const gone = p.age > p.life || p.x < this.cameraX - 250 || p.x > this.level.width + 250;
      if (hit) {
        this._explodeProjectile(p);
      } else if (gone) {
        this.projectiles.splice(i, 1);
      }
    }
  },

  _explodeProjectile(p) {
    const impactFrames = Assets.getFramesStrict(p.charId, 'specialImpact');
    if (impactFrames && impactFrames.length) {
      p.state = 'impact';
      p.impactTimer = 0;
      p.frameIndex = 0;
    } else {
      this.particles.burst(p.x, p.y, CHARACTERS[p.charId].color, 14, { speed: 220, life: 420 });
      this.projectiles.splice(this.projectiles.indexOf(p), 1);
    }
    AudioSys.sfx('hit');
  },

  _drawProjectiles(ctx) {
    for (const p of this.projectiles) {
      const stateKey = p.state === 'impact' ? 'specialImpact' : 'specialProj';
      const frames = Assets.getFramesStrict(p.charId, stateKey);
      const x = p.x - this.cameraX;
      if (x < -300 || x > this.canvas.width + 300) continue;
      if (frames && frames.length) {
        const idx = p.state === 'impact'
          ? Math.min(frames.length - 1, Math.floor(p.impactTimer / 140))
          : p.frameIndex;
        const img = frames[idx];
        const s = 0.85 * (p.scale || 1);
        const w = img.width * s, h = img.height * s;
        ctx.save();
        ctx.translate(x, p.y);
        if (p.vx < 0) ctx.scale(-1, 1);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
      } else {
        ctx.fillStyle = CHARACTERS[p.charId].color;
        ctx.beginPath();
        ctx.arc(x, p.y, 12 * (p.scale || 1), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  _resolveHazards() {
    if (this.player.isInvulnerable) return;
    const pbox = getAABB(this.player);
    for (const trap of this.level.traps) {
      if (rectsOverlap(pbox, trap)) {
        const dir = this.player.x < trap.x + trap.w / 2 ? -1 : 1;
        this.player.takeDamage(trap.type === 'lava' ? 22 : 14, dir, this.particles, this.shake);
        break;
      }
    }
  },

  _resolvePickups() {
    const pbox = getAABB(this.player);
    for (let i = this.activeItems.length - 1; i >= 0; i--) {
      const it = this.activeItems[i];
      const box = { x: it.x - 16, y: it.y - 16, w: 32, h: 32 };
      if (rectsOverlap(pbox, box)) {
        this._collectItem(it);
        this.activeItems.splice(i, 1);
      }
    }
  },

  _collectItem(it) {
    const def = ITEM_DEFS[it.id];
    this.player.collectedItemIds.add(it.key);
    AudioSys.sfx('pickup');
    if (def.type === 'heal') {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + def.heal);
      UI.toast(`+${def.heal} HP (${def.name})`);
    } else if (def.type === 'special') {
      this.player.gainDigiSoul(def.soul || 20);
      UI.toast(`DigiAlma +${def.soul} (${def.name})`);
    } else {
      this.player.inventory.push(it.id);
      UI.toast(`Item obtido: ${def.name}`);
    }
  },

  _resolveCheckpoints() {
    const pbox = getAABB(this.player);
    this.level.checkpoints.forEach((cp, i) => {
      const box = { x: cp.x - 20, y: cp.y - 60, w: 40, h: 60 };
      if (i !== this.checkpointIndex && rectsOverlap(pbox, box)) {
        this.checkpointIndex = i;
        AudioSys.sfx('checkpoint');
        UI.toast('Checkpoint alcançado!');
        this._autosave();
      }
    });
  },

  _resolveSecret() {
    if (this.secretUnlockedThisLevel || !this.level.secret) return;
    const pbox = getAABB(this.player);
    if (rectsOverlap(pbox, this.level.secret.trigger)) {
      this.secretUnlockedThisLevel = true;
      this.player.unlockedSecrets.add(`${this.level.id}:secret`);
      this.activeItems.push({ ...this.level.secret.area, x: this.level.secret.area.x + this.level.secret.area.w / 2, y: this.level.secret.area.y + this.level.secret.area.h - 10, id: this.level.secret.itemId, key: `${this.level.id}:secret:item` });
      UI.toast(`Área secreta! ${this.level.secret.hint}`);
    }
  },

  _resolveDoor() {
    const door = this.level.door;
    const pbox = getAABB(this.player);
    const box = { x: door.x, y: door.y, w: door.w, h: door.h };
    if (!rectsOverlap(pbox, box)) return;
    const hasKey = this.player.inventory.includes(door.requiresItem);
    if (!hasKey) {
      if (!this._doorMsgCooldown || this._doorMsgCooldown < performance.now()) {
        UI.toast(`Precisa de: ${ITEM_DEFS[door.requiresItem].name}`);
        this._doorMsgCooldown = performance.now() + 2000;
      }
      return;
    }
    if (this.levelComplete) return;
    this.levelComplete = true;
    const idx = this.player.inventory.indexOf(door.requiresItem);
    if (idx >= 0) this.player.inventory.splice(idx, 1);
    AudioSys.sfx('door');
    this._autosave();
    setTimeout(() => this._advanceLevel(), 600);
  },

  _advanceLevel() {
    const nextIdx = this.levelIndex + 1;
    if (nextIdx >= LEVELS.length) {
      this.appState = APP_STATE.VICTORY;
      UI.showVictory();
      return;
    }
    this.levelIndex = nextIdx;
    this.loadLevel(LEVELS[nextIdx].id, 0);
  },

  _autosave() {
    SaveSystem.save(this._snapshot());
  },

  manualSave() {
    const ok = SaveSystem.save(this._snapshot());
    AudioSys.sfx('save');
    return ok;
  },

  _snapshot() {
    const p = this.player;
    return {
      character: p.rookieId, evolved: p.evolved,
      unlockedEvolutions: [...p.unlockedEvolutions],
      levelId: this.level.id, checkpoint: this.checkpointIndex,
      hp: p.hp, maxHp: p.maxHp, sp: p.sp, maxSp: p.maxSp,
      level: p.level, exp: p.exp, digiSoul: p.digiSoul,
      inventory: p.inventory, collectedItemIds: [...p.collectedItemIds],
      defeatedBosses: [...p.defeatedBosses], unlockedSecrets: [...p.unlockedSecrets]
    };
  },

  hudState() {
    const p = this.player;
    return {
      charId: p.charId, hp: p.hp, maxHp: p.maxHp, sp: p.sp, maxSp: p.maxSp,
      level: p.level, exp: p.exp, expToNext: p.expToNextLevel(),
      evolved: p.evolved, canEvolve: p.canEvolve(),
      levelName: this.level.name, levelWidth: this.level.width,
      playerX: p.x, checkpoints: this.level.checkpoints,
      bossPos: this.boss && !this.boss.dead ? this.boss : (this._bossSpawn || null),
      doorPos: this.level.door
    };
  },

  // ----------------------------------------------------------------- render
  render() {
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    if (this.appState !== APP_STATE.PLAYING && this.appState !== APP_STATE.PAUSED) return;

    const shakeOff = this.shake.getOffset();
    ctx.save();
    ctx.translate(shakeOff.x, shakeOff.y);

    this._drawSky(ctx, w, h);
    this._drawGround(ctx, w, h);
    for (const trap of this.level.traps) this._drawTrap(ctx, trap);
    this._drawSecretHint(ctx);
    this._drawDoor(ctx);
    for (const cp of this.level.checkpoints) this._drawCheckpoint(ctx, cp);
    for (const it of this.activeItems) this._drawItem(ctx, it);
    for (const en of this.enemies) en.draw(ctx, this.cameraX);
    if (this.boss) this.boss.draw(ctx, this.cameraX);
    this.player.draw(ctx, this.cameraX);
    this._drawProjectiles(ctx);
    this.particles.draw(ctx, this.cameraX);

    if (this.boss && !this.boss.dead) this._drawBossBar(ctx, w);

    ctx.restore();

    HUD.draw(HUD.ctx, this.hudState());
  },

  _drawSky(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, this.level.sky[0]);
    g.addColorStop(1, this.level.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const theme = this.level.ambient;
    this._drawCelestial(ctx, w, theme);
    this._drawClouds(ctx, w, theme);
    this._drawSilhouettes(ctx, w, h, theme, 0.18, true);   // far layer
    this._drawSilhouettes(ctx, w, h, theme, 0.38, false);  // near layer
  },

  _drawCelestial(ctx, w, theme) {
    if (theme === 'forest') {
      ctx.fillStyle = 'rgba(255,244,190,0.9)';
      ctx.beginPath(); ctx.arc(w - 120, 84, 42, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,244,190,0.25)';
      ctx.beginPath(); ctx.arc(w - 120, 84, 62, 0, Math.PI * 2); ctx.fill();
    } else if (theme === 'volcano') {
      ctx.fillStyle = 'rgba(255,110,40,0.55)';
      ctx.beginPath(); ctx.arc(w - 150, 120, 52, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,60,20,0.18)';
      ctx.beginPath(); ctx.arc(w - 150, 120, 84, 0, Math.PI * 2); ctx.fill();
    } else {
      // night themes: stars + moon
      for (let i = 0; i < 42; i++) {
        const sx = hash01(i * 3 + 1) * w;
        const sy = hash01(i * 7 + 2) * 220;
        ctx.fillStyle = `rgba(255,255,255,${0.25 + hash01(i) * 0.5})`;
        ctx.fillRect(sx, sy, 2, 2);
      }
      ctx.fillStyle = '#e8ecf8';
      ctx.beginPath(); ctx.arc(w - 130, 90, 34, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = this.level.sky[0];
      ctx.beginPath(); ctx.arc(w - 118, 80, 30, 0, Math.PI * 2); ctx.fill();
    }
  },

  _drawClouds(ctx, w, theme) {
    const cfg = THEME_BG[theme] || THEME_BG.forest;
    ctx.fillStyle = cfg.cloud;
    const span = w + 560;
    for (let i = 0; i < 6; i++) {
      let cx = (i * 430 + hash01(i + 21) * 320 - this.cameraX * 0.12) % span;
      if (cx < 0) cx += span;
      cx -= 280;
      const cy = 46 + hash01(i + 40) * 120;
      const r = 26 + hash01(i + 60) * 26;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 2.1, r * 0.75, 0, 0, Math.PI * 2);
      ctx.ellipse(cx - r, cy + 6, r * 1.3, r * 0.55, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + r * 1.1, cy + 5, r * 1.2, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  _drawSilhouettes(ctx, w, h, theme, par, far) {
    const cfg = THEME_BG[theme] || THEME_BG.forest;
    ctx.fillStyle = far ? cfg.far : cfg.near;
    const baseY = far ? h * 0.68 : h * 0.78;
    const off = this.cameraX * par;
    const style = cfg.style;

    if (style === 'trees') {
      const step = 96;
      const first = Math.floor(off / step) - 2;
      for (let i = first; i * step - off < w + step; i++) {
        const sx = i * step - off;
        const r = (far ? 46 : 62) + hash01(i * 13) * 42;
        ctx.beginPath(); ctx.arc(sx, baseY - r * 0.55, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillRect(0, baseY, w, h - baseY);
    } else if (style === 'buildings') {
      const step = 88;
      const first = Math.floor(off / step) - 2;
      for (let i = first; i * step - off < w + step; i++) {
        const sx = i * step - off;
        const bw = 54 + hash01(i * 17) * 46;
        const bh = (far ? 70 : 110) + hash01(i * 29) * 150;
        ctx.fillRect(sx, baseY - bh, bw, bh + (h - baseY));
        if (!far) {
          // lit windows
          for (let wy = 0; wy < 5; wy++) {
            for (let wx = 0; wx < 3; wx++) {
              if (hash01(i * 97 + wy * 11 + wx * 5) > 0.55) {
                ctx.fillStyle = 'rgba(255,222,120,0.75)';
                ctx.fillRect(sx + 8 + wx * 14, baseY - bh + 12 + wy * 20, 5, 7);
              }
            }
          }
          ctx.fillStyle = THEME_BG[theme].near;
        }
      }
      ctx.fillRect(0, baseY, w, h - baseY);
    } else if (style === 'peaks') {
      const step = 150;
      const first = Math.floor(off / step) - 2;
      ctx.beginPath();
      ctx.moveTo(-50, h);
      for (let i = first; i * step - off < w + step * 2; i++) {
        const sx = i * step - off;
        const ph = (far ? 70 : 120) + hash01(i * 31) * 130;
        ctx.lineTo(sx, baseY - ph);
        ctx.lineTo(sx + step * 0.5, baseY - ph * (0.35 + hash01(i * 7) * 0.3));
      }
      ctx.lineTo(w + 50, h);
      ctx.closePath(); ctx.fill();
      if (!far) {
        // ember glow along the ridge line
        ctx.fillStyle = 'rgba(255,90,30,0.16)';
        ctx.fillRect(0, baseY - 40, w, 40);
        ctx.fillStyle = cfg.near;
      }
    } else { // towers
      const step = 170;
      const first = Math.floor(off / step) - 2;
      for (let i = first; i * step - off < w + step; i++) {
        const sx = i * step - off;
        const tw = 44 + hash01(i * 11) * 22;
        const th = (far ? 90 : 140) + hash01(i * 23) * 120;
        ctx.fillRect(sx, baseY - th, tw, th + (h - baseY));
        // battlements + spire
        for (let b = 0; b < 4; b++) ctx.fillRect(sx + b * (tw / 3.6), baseY - th - 10, tw / 6, 10);
        ctx.beginPath();
        ctx.moveTo(sx + tw * 0.5 - 14, baseY - th);
        ctx.lineTo(sx + tw * 0.5, baseY - th - 42);
        ctx.lineTo(sx + tw * 0.5 + 14, baseY - th);
        ctx.closePath(); ctx.fill();
        if (!far && hash01(i * 41) > 0.4) {
          ctx.fillStyle = 'rgba(255,190,90,0.8)';
          ctx.fillRect(sx + tw * 0.5 - 3, baseY - th + 26, 6, 10);
          ctx.fillStyle = cfg.near;
        }
      }
      ctx.fillRect(0, baseY, w, h - baseY);
    }
  },

  _drawGround(ctx, w, h) {
    const theme = this.level.ambient;
    const cfg = THEME_BG[theme] || THEME_BG.forest;
    for (const p of this.level.platforms) {
      const x = p.x - this.cameraX;
      if (x + p.w < 0 || x > w) continue;

      // body
      ctx.fillStyle = this.level.groundEdge;
      ctx.fillRect(x, p.y, p.w, p.h);
      // body texture speckles (deterministic per world position)
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      for (let gx = Math.floor(p.x / 34) * 34; gx < p.x + p.w - 8; gx += 34) {
        for (let gy = Math.floor(p.y / 26) * 26 + 14; gy < p.y + p.h - 6; gy += 26) {
          if (hash01(gx * 7 + gy * 13) > 0.5) ctx.fillRect(gx - this.cameraX, gy, 6, 4);
        }
      }
      // side shading
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x, p.y, 4, p.h);
      ctx.fillRect(x + p.w - 4, p.y, 4, p.h);

      // top surface strip + themed accent line
      ctx.fillStyle = this.level.groundColor;
      ctx.fillRect(x, p.y, p.w, 10);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(x, p.y, p.w, 2);
      ctx.fillStyle = cfg.top;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(x, p.y + 2, p.w, 2);
      ctx.globalAlpha = 1;

      // top decoration every ~64px: grass tufts / neon studs / embers / runes
      for (let gx = Math.ceil(p.x / 64) * 64; gx < p.x + p.w - 8; gx += 64) {
        const dx = gx - this.cameraX;
        const v = hash01(gx * 3 + p.y);
        if (v < 0.3) continue;
        if (theme === 'forest') {
          ctx.strokeStyle = cfg.top; ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(dx, p.y); ctx.lineTo(dx - 3, p.y - 7);
          ctx.moveTo(dx + 4, p.y); ctx.lineTo(dx + 4, p.y - 9);
          ctx.moveTo(dx + 8, p.y); ctx.lineTo(dx + 11, p.y - 6);
          ctx.stroke();
        } else if (theme === 'city') {
          ctx.fillStyle = cfg.top;
          ctx.fillRect(dx, p.y - 3, 8, 3);
        } else if (theme === 'volcano') {
          const glow = 0.4 + Math.sin(performance.now() / 350 + gx) * 0.25;
          ctx.fillStyle = `rgba(255,120,40,${glow})`;
          ctx.fillRect(dx, p.y - 2, 10, 2);
        } else {
          ctx.fillStyle = cfg.top;
          ctx.globalAlpha = 0.7;
          ctx.fillRect(dx, p.y - 4, 3, 4); ctx.fillRect(dx + 6, p.y - 6, 3, 6);
          ctx.globalAlpha = 1;
        }
      }
    }
  },

  _drawTrap(ctx, trap) {
    const x = trap.x - this.cameraX;
    if (x + trap.w < 0 || x > this.canvas.width) return;
    if (trap.type === 'lava') {
      const glow = 0.5 + Math.sin(performance.now() / 300 + trap.x) * 0.15;
      ctx.fillStyle = `rgba(255,${90 + glow * 60},20,0.95)`;
      ctx.fillRect(x, trap.y, trap.w, trap.h);
      ctx.fillStyle = `rgba(255,220,120,${0.5 + glow * 0.3})`;
      ctx.fillRect(x, trap.y, trap.w, 4);
    } else {
      ctx.fillStyle = '#b8bcc4';
      const n = Math.max(1, Math.floor(trap.w / 18));
      for (let i = 0; i < n; i++) {
        const sx = x + i * (trap.w / n);
        ctx.beginPath();
        ctx.moveTo(sx, trap.y + trap.h);
        ctx.lineTo(sx + trap.w / n / 2, trap.y);
        ctx.lineTo(sx + trap.w / n, trap.y + trap.h);
        ctx.closePath();
        ctx.fill();
      }
    }
  },

  _drawCheckpoint(ctx, cp) {
    const x = cp.x - this.cameraX;
    if (x < -30 || x > this.canvas.width + 30) return;
    const active = this.level.checkpoints.indexOf(cp) === this.checkpointIndex;
    ctx.strokeStyle = '#8a8a8a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, cp.y); ctx.lineTo(x, cp.y - 70); ctx.stroke();
    ctx.fillStyle = active ? '#4fd0ff' : '#556';
    ctx.beginPath();
    ctx.moveTo(x, cp.y - 70); ctx.lineTo(x + 26, cp.y - 58); ctx.lineTo(x, cp.y - 46);
    ctx.closePath(); ctx.fill();
  },

  _drawItem(ctx, it) {
    const x = it.x - this.cameraX, y = it.y + Math.sin(performance.now() / 260 + it.x) * 5;
    if (x < -30 || x > this.canvas.width + 30) return;
    const def = ITEM_DEFS[it.id];
    ctx.save();
    ctx.translate(x, y);
    ctx.font = '26px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(255,255,150,0.8)'; ctx.shadowBlur = 10;
    ctx.fillText(def.icon, 0, 0);
    ctx.restore();
  },

  _drawDoor(ctx) {
    const door = this.level.door;
    const x = door.x - this.cameraX;
    if (x < -80 || x > this.canvas.width + 80) return;
    const hasKey = this.player.inventory.includes(door.requiresItem);
    ctx.fillStyle = hasKey ? '#5a3a1a' : '#2a2a2a';
    ctx.fillRect(x, door.y, door.w, door.h);
    ctx.fillStyle = hasKey ? '#e8c060' : '#666';
    ctx.fillRect(x + 6, door.y + 6, door.w - 12, door.h - 12);
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(hasKey ? '🚪' : '🔒', x + door.w / 2, door.y + door.h / 2 + 8);
    ctx.textAlign = 'left';
  },

  _drawSecretHint(ctx) {
    const s = this.level.secret;
    if (!s || this.secretUnlockedThisLevel) return;
    const x = s.trigger.x - this.cameraX + s.trigger.w / 2;
    const y = s.trigger.y;
    if (x < -20 || x > this.canvas.width + 20) return;
    ctx.fillStyle = `rgba(255,255,255,${0.15 + Math.sin(performance.now() / 400) * 0.1})`;
    ctx.beginPath(); ctx.arc(x, y + 20, 14, 0, Math.PI * 2); ctx.fill();
  },

  _drawBossBar(ctx, w) {
    const b = this.boss;
    const barW = w * 0.6, x = (w - barW) / 2, y = 26;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 4, y - 4, barW + 8, 26);
    ctx.fillStyle = '#3a0a0a';
    ctx.fillRect(x, y, barW, 18);
    ctx.fillStyle = '#e83030';
    ctx.fillRect(x, y, barW * Math.max(0, b.hp / b.maxHp), 18);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(b.name + (b.phase === 2 ? ' — FÚRIA' : ''), w / 2, y + 13);
    ctx.textAlign = 'left';
  }
};
