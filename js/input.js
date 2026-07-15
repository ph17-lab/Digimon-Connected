/*
 * input.js — unified input abstraction for keyboard (PC) and touch (mobile).
 * Game code only ever asks Input.isDown('left') / Input.pressed('jump') etc,
 * regardless of which physical control produced it.
 */
'use strict';

const DEFAULT_KEYBINDS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  jump: ['Space', 'KeyZ', 'KeyW', 'ArrowUp'],
  attack: ['KeyX', 'KeyJ'],
  special: ['KeyV', 'KeyK'],
  evolve: ['KeyC', 'KeyL'],
  pause: ['Escape', 'KeyP']
};

const Input = {
  keybinds: JSON.parse(JSON.stringify(DEFAULT_KEYBINDS)),
  _down: new Set(),          // physical codes currently held
  _justPressedCodes: new Set(), // codes that fired keydown since the last update() drain
  _actionDown: {},           // action -> bool (keyboard or touch)
  _actionPressedQueue: {},   // action -> bool (edge-triggered, consumed each frame)
  _prevActionDown: {},
  _touchJustPressed: {},     // action -> bool, set by ui.js touch handlers on touchstart

  init() {
    window.addEventListener('keydown', (e) => {
      if (this._remapCallback) { this._remapCallback(e.code); return; }
      if (!this._down.has(e.code)) this._justPressedCodes.add(e.code);
      this._down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this._down.delete(e.code));
    window.addEventListener('blur', () => this._down.clear());
  },

  // called once per frame by the game loop, BEFORE reading pressed()
  // uses the justPressed queue (populated directly by DOM events) rather than
  // a pure frame-to-frame diff, so a keydown+keyup that both happen between
  // two animation frames still registers as a press instead of being missed.
  update() {
    for (const action of Object.keys(this.keybinds)) {
      const codes = this.keybinds[action];
      const keyDown = codes.some(c => this._down.has(c));
      const touchDown = !!this._touchState[action];
      const isDown = keyDown || touchDown;
      const justPressed = codes.some(c => this._justPressedCodes.has(c)) || this._touchJustPressed[action];
      this._actionPressedQueue[action] = justPressed || (isDown && !this._prevActionDown[action]);
      this._prevActionDown[action] = isDown;
      this._actionDown[action] = isDown;
      this._touchJustPressed[action] = false;
    }
    this._justPressedCodes.clear();
  },

  isDown(action) { return !!this._actionDown[action]; },
  pressed(action) { return !!this._actionPressedQueue[action]; },

  // ---- touch state (set by ui.js touch control handlers) ------------------
  _touchState: {},
  setTouch(action, isDown) {
    if (isDown && !this._touchState[action]) this._touchJustPressed[action] = true;
    this._touchState[action] = isDown;
  },

  // ---- keybind remap ------------------------------------------------------
  startRemap(action, cb) {
    this._remapCallback = (code) => {
      this.keybinds[action] = [code];
      this._remapCallback = null;
      cb(code);
    };
  },

  resetDefaults() { this.keybinds = JSON.parse(JSON.stringify(DEFAULT_KEYBINDS)); }
};

Input.init();
