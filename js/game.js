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

const Game = {
  canvas: null, ctx: null,
  appState: APP_STATE.BOOT,
  player: null,
  level: null,
  levelIndex: 0,
  enemies: [],
  boss: null,
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

  _resolvePlayerAttacks() {
    const box = this.player.getAttackHitbox();
    if (!box) return;
    const dmg = this.player.getAttackDamage();
    const targets = this.boss ? [...this.enemies, this.boss] : this.enemies;
    for (const en of targets) {
      if (en.dead || this.player.attackHitEnemies.has(en)) continue;
      if (rectsOverlap(box, getAABB(en))) {
        en.takeDamage(dmg, this.player.facing, this.particles);
        this.player.attackHitEnemies.add(en);
        this.shake.trigger(4, 100);
        if (en.dead) {
          this.player.gainExp(en.def.expReward);
          this.player.gainDigiSoul(en.def.soulReward || 10);
          if (en.isBoss) this.player.defeatedBosses.add(this.level.id);
        }
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
    // simple parallax silhouettes
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 6; i++) {
      const bx = (i * 400 - this.cameraX * 0.3) % (w + 400) - 200;
      ctx.beginPath();
      ctx.ellipse(bx, h * 0.75, 220, 90, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  _drawGround(ctx, w, h) {
    for (const p of this.level.platforms) {
      const x = p.x - this.cameraX;
      if (x + p.w < 0 || x > w) continue;
      ctx.fillStyle = this.level.groundEdge;
      ctx.fillRect(x, p.y, p.w, p.h);
      ctx.fillStyle = this.level.groundColor;
      ctx.fillRect(x, p.y, p.w, Math.min(10, p.h));
      ctx.fillStyle = this.level.groundColor;
      ctx.fillRect(x, p.y + 6, p.w, p.h - 6);
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
