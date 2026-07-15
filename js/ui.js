/*
 * ui.js — screen/menu management, settings, touch controls, Digivice panels.
 * Owns every DOM element outside the two canvases; game.js never touches
 * the DOM directly (it goes through UI.toast / UI.showGameOver / etc).
 */
'use strict';

const KEYBIND_LABELS = {
  left: 'Esquerda', right: 'Direita', jump: 'Pular',
  attack: 'Ataque (M1)', special: 'Especial', evolve: 'Digievoluir', pause: 'Pausar'
};

const Settings = {
  platform: null, // 'pc' | 'mobile'
  musicVolume: 60, sfxVolume: 80,
  load() {
    const s = SaveSystem.loadSettings();
    if (s) Object.assign(this, s);
    if (s && s.keybinds) Input.keybinds = s.keybinds;
  },
  persist() {
    SaveSystem.saveSettings({
      platform: this.platform, musicVolume: this.musicVolume, sfxVolume: this.sfxVolume,
      keybinds: Input.keybinds
    });
  }
};

const UI = {
  selectedChar: null,
  _toastTimer: null,

  init() {
    Settings.load();
    HUD.init(document.getElementById('hud-canvas'), (key) => this.openPanel(key));
    this._wireGlobalClicks();
    this._wireSettings();
    this._wireTouchControls();
    this._wireCharSelect();

    document.body.addEventListener('pointerdown', () => { AudioSys.init(); AudioSys.resume(); }, { once: true });

    if (!Settings.platform) {
      this.show('screen-platform');
    } else {
      this._applyPlatform();
      this.show('screen-main');
      AudioSys.init();
      AudioSys.playTheme('menu');
    }
  },

  // ---------------------------------------------------------------- screens
  show(id) {
    document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
  },
  hideAllScreens() { document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden')); },

  enterGame() {
    this.hideAllScreens();
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('game').classList.remove('hidden');
    if (Settings.platform === 'mobile') document.getElementById('touch-controls').classList.remove('hidden');
    AudioSys.playTheme(Game.level.ambient);
  },

  exitToMenu() {
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('touch-controls').classList.add('hidden');
    this.show('screen-main');
    AudioSys.playTheme('menu');
  },

  clearToast() {
    clearTimeout(this._toastTimer);
    document.getElementById('toast').classList.add('hidden');
  },

  toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
  },

  // ------------------------------------------------------------- game flow
  openPause() {
    if (Game.appState !== APP_STATE.PLAYING) return;
    Game.appState = APP_STATE.PAUSED;
    this.show('screen-pause');
  },
  resumeGame() {
    Game.appState = APP_STATE.PLAYING;
    this.hideAllScreens();
  },
  showGameOver() {
    document.getElementById('gameover-title').textContent = 'FIM DE JOGO';
    document.getElementById('gameover-info').textContent = `${CHARACTERS[Game.player.rookieId].name} caiu em batalha.`;
    document.querySelector('#screen-gameover [data-menu-action="retry-checkpoint"]').classList.remove('hidden');
    this.show('screen-gameover');
  },
  showVictory() {
    document.getElementById('gameover-title').textContent = 'DIGIMUNDO SALVO!';
    document.getElementById('gameover-info').textContent = 'Você derrotou Devimon e completou Digimon Connected.';
    document.querySelector('#screen-gameover [data-menu-action="retry-checkpoint"]').classList.add('hidden');
    SaveSystem.clear();
    this.show('screen-gameover');
  },

  // -------------------------------------------------------------- routing
  _wireGlobalClicks() {
    document.querySelectorAll('[data-platform]').forEach(btn => {
      btn.addEventListener('click', () => {
        Settings.platform = btn.dataset.platform;
        Settings.persist();
        this._applyPlatform();
        AudioSys.init(); AudioSys.playTheme('menu');
        this.show('screen-main');
      });
    });

    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-menu-action]');
      if (!btn) return;
      AudioSys.sfx('menu');
      this._handleMenuAction(btn.dataset.menuAction);
    });
  },

  _handleMenuAction(action) {
    switch (action) {
      case 'new-game': this.show('screen-charselect'); this._renderCharCards(); break;
      case 'continue':
        if (SaveSystem.hasSave()) {
          Game.loadGameFromSave(SaveSystem.load());
          this.enterGame();
        } else this.toast('Nenhum save encontrado.');
        break;
      case 'settings': this._renderKeybinds(); this.show('screen-settings'); break;
      case 'credits': this.show('screen-credits'); break;
      case 'exit': this.toast('Pode fechar esta aba para sair.'); break;
      case 'back-main':
        if (Game.appState === APP_STATE.PAUSED) this.show('screen-pause');
        else this.show('screen-main');
        break;
      case 'confirm-char':
        if (this.selectedChar) { Game.startNewGame(this.selectedChar); this.enterGame(); }
        break;
      case 'resume': this.resumeGame(); break;
      case 'save-now': AudioSys.sfx('confirm'); Game.manualSave() ? this.toast('Jogo salvo!') : this.toast('Falha ao salvar.'); break;
      case 'quit-to-menu': Game.appState = APP_STATE.MAIN_MENU; this.exitToMenu(); break;
      case 'retry-checkpoint': Game.respawnAtCheckpoint(); this.enterGame(); break;
      case 'close-panel': this._closeAllPanels(); break;
      case 'do-save':
        Game.manualSave();
        document.getElementById('save-status-text').textContent = 'Salvo agora — ' + new Date().toLocaleTimeString();
        break;
    }
  },

  _applyPlatform() {
    document.getElementById('touch-controls').classList.toggle('hidden', Settings.platform !== 'mobile' || Game.appState !== APP_STATE.PLAYING);
    document.querySelectorAll('[data-set-platform]').forEach(b => b.classList.toggle('active', b.dataset.setPlatform === Settings.platform));
  },

  // ------------------------------------------------------------ char select
  _wireCharSelect() {},

  _renderCharCards() {
    const wrap = document.getElementById('char-cards');
    wrap.innerHTML = '';
    this.selectedChar = null;
    document.getElementById('btn-confirm-char').disabled = true;
    for (const id of STARTERS) {
      const def = CHARACTERS[id];
      const champ = CHARACTERS[def.evolvesTo];
      const card = document.createElement('button');
      card.className = 'char-card';
      card.innerHTML = `
        <canvas width="110" height="110"></canvas>
        <span class="char-name">${def.name}</span>
        <span class="char-evo">&rarr; ${champ.name}</span>`;
      card.addEventListener('click', () => {
        this.selectedChar = id;
        wrap.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        document.getElementById('btn-confirm-char').disabled = false;
      });
      wrap.appendChild(card);
      const cvs = card.querySelector('canvas');
      this._drawCharPreview(cvs, id);
    }
  },

  _drawCharPreview(canvas, charId) {
    const ctx = canvas.getContext('2d');
    const anim = getSpriteAnimator(charId);
    let raf;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      anim.setState('idle');
      anim.update(16);
      anim.draw(ctx, canvas.width / 2, canvas.height - 6, 1, 0.85);
      if (document.body.contains(canvas)) raf = requestAnimationFrame(draw);
    };
    draw();
  },

  // ---------------------------------------------------------------- settings
  _wireSettings() {
    document.querySelectorAll('[data-set-platform]').forEach(btn => {
      btn.addEventListener('click', () => {
        Settings.platform = btn.dataset.setPlatform;
        Settings.persist();
        this._applyPlatform();
        this.toast(`Plataforma: ${Settings.platform === 'pc' ? 'PC' : 'Mobile'}`);
      });
    });
    const musicSlider = document.getElementById('vol-music');
    const sfxSlider = document.getElementById('vol-sfx');
    musicSlider.value = Settings.musicVolume;
    sfxSlider.value = Settings.sfxVolume;
    musicSlider.addEventListener('input', () => {
      Settings.musicVolume = +musicSlider.value;
      AudioSys.setMusicVolume(Settings.musicVolume / 100);
      Settings.persist();
    });
    sfxSlider.addEventListener('input', () => {
      Settings.sfxVolume = +sfxSlider.value;
      AudioSys.setSfxVolume(Settings.sfxVolume / 100);
      Settings.persist();
    });
  },

  _renderKeybinds() {
    const grid = document.getElementById('keybind-grid');
    grid.innerHTML = '';
    for (const action of Object.keys(KEYBIND_LABELS)) {
      const row = document.createElement('div');
      row.className = 'keybind-row';
      const codes = Input.keybinds[action];
      row.innerHTML = `<span>${KEYBIND_LABELS[action]}</span><button class="keybind-key">${codes[0]}</button>`;
      const keyBtn = row.querySelector('button');
      keyBtn.addEventListener('click', () => {
        keyBtn.textContent = 'Pressione uma tecla...';
        Input.startRemap(action, (code) => {
          keyBtn.textContent = code;
          Settings.persist();
        });
      });
      grid.appendChild(row);
    }
  },

  // ------------------------------------------------------------ touch input
  _wireTouchControls() {
    const map = { left: 'left', right: 'right', jump: 'jump', attack: 'attack', special: 'special', evolve: 'evolve' };
    document.querySelectorAll('.touch-btn[data-action]').forEach(btn => {
      const action = btn.dataset.action;
      const start = (e) => {
        e.preventDefault();
        if (action === 'pause') { this.openPause(); return; }
        Input.setTouch(map[action], true);
        btn.classList.add('active');
      };
      const end = (e) => {
        e.preventDefault();
        if (action === 'pause') return;
        Input.setTouch(map[action], false);
        btn.classList.remove('active');
      };
      btn.addEventListener('touchstart', start, { passive: false });
      btn.addEventListener('touchend', end, { passive: false });
      btn.addEventListener('touchcancel', end, { passive: false });
      btn.addEventListener('mousedown', start);
      btn.addEventListener('mouseup', end);
      btn.addEventListener('mouseleave', end);
    });
  },

  // ------------------------------------------------------------ digivice panels
  openPanel(key) {
    if (Game.appState !== APP_STATE.PLAYING) return;
    Game.appState = APP_STATE.PAUSED;
    this._closeAllPanels();
    const panel = document.getElementById(`panel-${key}`);
    if (!panel) return;
    if (key === 'evolution') this._renderEvolutionPanel();
    if (key === 'backpack') this._renderBackpackPanel();
    if (key === 'save') this._renderSavePanel();
    if (key === 'map') this._renderMapPanel();
    panel.classList.remove('hidden');
  },

  _closeAllPanels() {
    document.querySelectorAll('.digivice-panel').forEach(p => p.classList.add('hidden'));
    if (Game.appState === APP_STATE.PAUSED && !document.getElementById('screen-pause').classList.contains('hidden') === false) {
      // only resume if no other blocking screen is open
    }
    if (Game.appState === APP_STATE.PAUSED) Game.appState = APP_STATE.PLAYING;
  },

  _renderEvolutionPanel() {
    const wrap = document.getElementById('evolution-list');
    wrap.innerHTML = '';
    const p = Game.player;
    const rookieDef = CHARACTERS[p.rookieId];
    const champDef = CHARACTERS[rookieDef.evolvesTo];
    const entries = [
      { def: rookieDef, unlocked: true, active: !p.evolved },
      { def: champDef, unlocked: true, active: p.evolved, requiresFull: !p.evolved }
    ];
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'evolution-row' + (entry.active ? ' active' : '');
      const ready = entry.def === champDef ? p.canEvolve() : true;
      row.innerHTML = `
        <canvas width="70" height="70"></canvas>
        <div class="evolution-info">
          <strong>${entry.def.name}</strong>
          <span>${entry.active ? 'Forma atual' : (entry.def === champDef ? (ready ? 'Pronta para digievoluir!' : 'Requer barra DigiSoul cheia') : '')}</span>
        </div>`;
      if (entry.def === champDef && !entry.active) {
        const btn = document.createElement('button');
        btn.className = 'btn-primary';
        btn.textContent = 'Digievoluir';
        btn.disabled = !ready;
        btn.addEventListener('click', () => {
          if (Game.player.evolve(Game.particles, Game.shake)) {
            this._closeAllPanels();
          }
        });
        row.appendChild(btn);
      }
      wrap.appendChild(row);
      this._drawCharPreview(row.querySelector('canvas'), entry.def.id);
    }
  },

  _renderBackpackPanel() {
    const grid = document.getElementById('backpack-grid');
    grid.innerHTML = '';
    const p = Game.player;
    if (!p.inventory.length) {
      grid.innerHTML = '<p class="empty-hint">Mochila vazia.</p>';
      return;
    }
    const counts = {};
    for (const id of p.inventory) counts[id] = (counts[id] || 0) + 1;
    for (const id of Object.keys(counts)) {
      const def = ITEM_DEFS[id];
      const cell = document.createElement('div');
      cell.className = 'backpack-item';
      cell.innerHTML = `<span class="bp-icon">${def.icon}</span><span class="bp-name">${def.name}</span><span class="bp-count">x${counts[id]}</span>`;
      if (def.type === 'heal') {
        cell.classList.add('usable');
        cell.addEventListener('click', () => {
          const idx = p.inventory.indexOf(id);
          if (idx >= 0) {
            p.inventory.splice(idx, 1);
            p.hp = Math.min(p.maxHp, p.hp + def.heal);
            AudioSys.sfx('pickup');
            this._renderBackpackPanel();
          }
        });
      }
      grid.appendChild(cell);
    }
  },

  _renderSavePanel() {
    const raw = SaveSystem.load();
    const el = document.getElementById('save-status-text');
    el.textContent = raw ? `Último save: ${new Date(raw.savedAt).toLocaleString()}` : 'Nenhum save ainda.';
  },

  _renderMapPanel() {
    const canvas = document.getElementById('map-canvas');
    const ctx = canvas.getContext('2d');
    const level = Game.level;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0a1220';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scaleX = canvas.width / level.width;
    ctx.fillStyle = level.groundColor;
    for (const pl of level.platforms) {
      ctx.fillRect(pl.x * scaleX, canvas.height - 40 - (level.groundY - pl.y) * 0.3, Math.max(2, pl.w * scaleX), 6);
    }
    level.checkpoints.forEach((cp, i) => {
      ctx.fillStyle = i === Game.checkpointIndex ? '#4fd0ff' : '#557';
      ctx.beginPath(); ctx.arc(cp.x * scaleX, canvas.height - 40 - (level.groundY - cp.y) * 0.3, 5, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = '#ff4040';
    ctx.beginPath(); ctx.arc(level.boss.x * scaleX, canvas.height - 40 - (level.groundY - level.boss.y) * 0.3, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = Game.player.inventory.includes(level.door.requiresItem) ? '#40ff80' : '#ffd040';
    ctx.fillRect(level.door.x * scaleX - 3, canvas.height - 60, 6, 20);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(Game.player.x * scaleX, canvas.height - 40 - (level.groundY - Game.player.y) * 0.3, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#cfe8ff';
    ctx.font = '13px monospace';
    ctx.fillText(`${level.name} — Objetivo: derrote ${level.boss.name} e use a chave na porta`, 10, 18);
  }
};
