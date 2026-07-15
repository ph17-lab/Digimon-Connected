/*
 * audio.js — procedural music & SFX via WebAudio (no external files needed).
 * Exposes a small synth-based engine: SFX one-shots + a per-level looping
 * ambient track, both routed through separate gain nodes for the two
 * volume sliders in Settings.
 */
'use strict';

const AudioSys = {
  ctx: null,
  musicGain: null,
  sfxGain: null,
  musicNodes: [],
  musicTimer: null,
  currentTrack: null,
  musicVolume: 0.6,
  sfxVolume: 0.8,

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.musicGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVolume;
    this.sfxGain.gain.value = this.sfxVolume;
    this.musicGain.connect(this.ctx.destination);
    this.sfxGain.connect(this.ctx.destination);
  },

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },

  setMusicVolume(v01) { this.musicVolume = v01; if (this.musicGain) this.musicGain.gain.value = v01; },
  setSfxVolume(v01) { this.sfxVolume = v01; if (this.sfxGain) this.sfxGain.gain.value = v01; },

  // ---- one-shot SFX ------------------------------------------------------
  _blip(freq, dur, type, gainPeak, delay = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(this.sfxGain);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
    return osc;
  },

  _noiseBurst(dur, gainPeak, delay = 0) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainPeak, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(g); g.connect(this.sfxGain);
    src.start(t0);
  },

  sfx(name) {
    if (!this.ctx) return;
    switch (name) {
      case 'jump': this._blip(520, 0.14, 'square', 0.18); break;
      case 'land': this._blip(180, 0.08, 'sine', 0.15); break;
      case 'attack1': this._blip(300, 0.08, 'sawtooth', 0.2); break;
      case 'attack2': this._blip(360, 0.1, 'sawtooth', 0.22); break;
      case 'special': this._blip(220, 0.28, 'square', 0.25); this._blip(440, 0.2, 'square', 0.18, 0.06); break;
      case 'hit': this._noiseBurst(0.12, 0.3); break;
      case 'hurt': this._blip(140, 0.2, 'sawtooth', 0.25); break;
      case 'enemyDeath': this._blip(200, 0.3, 'triangle', 0.2); this._blip(90, 0.3, 'sine', 0.2, 0.08); break;
      case 'pickup': this._blip(700, 0.1, 'sine', 0.2); this._blip(900, 0.12, 'sine', 0.18, 0.07); break;
      case 'checkpoint': this._blip(500, 0.15, 'sine', 0.2); this._blip(700, 0.15, 'sine', 0.2, 0.1); this._blip(900, 0.2, 'sine', 0.2, 0.2); break;
      case 'save': this._blip(600, 0.1, 'sine', 0.18); this._blip(800, 0.14, 'sine', 0.18, 0.08); break;
      case 'menu': this._blip(440, 0.06, 'square', 0.12); break;
      case 'confirm': this._blip(660, 0.1, 'square', 0.16); break;
      case 'door': this._blip(150, 0.4, 'sawtooth', 0.2); break;
      case 'evolve':
        this._blip(220, 0.5, 'sawtooth', 0.22);
        this._blip(330, 0.5, 'sawtooth', 0.22, 0.15);
        this._blip(440, 0.6, 'square', 0.25, 0.3);
        this._blip(660, 0.8, 'square', 0.25, 0.5);
        break;
      case 'bossRoar': this._blip(80, 0.6, 'sawtooth', 0.3); this._noiseBurst(0.5, 0.25, 0.05); break;
      case 'gameover': this._blip(300, 0.3, 'sawtooth', 0.2); this._blip(200, 0.3, 'sawtooth', 0.2, 0.25); this._blip(100, 0.5, 'sawtooth', 0.2, 0.5); break;
    }
  },

  // ---- looping ambient music ---------------------------------------------
  // Simple generative arpeggio loop; different scale/tempo per theme so each
  // level and boss fight feels distinct without needing audio files.
  _themes: {
    forest:  { root: 220, scale: [0, 3, 5, 7, 10], tempo: 0.42, wave: 'triangle' },
    city:    { root: 196, scale: [0, 2, 3, 7, 9],  tempo: 0.32, wave: 'square' },
    volcano: { root: 174, scale: [0, 1, 5, 6, 10], tempo: 0.36, wave: 'sawtooth' },
    castle:  { root: 164, scale: [0, 3, 6, 7, 11], tempo: 0.38, wave: 'triangle' },
    boss:    { root: 130, scale: [0, 1, 4, 6, 7],  tempo: 0.2,  wave: 'square' },
    menu:    { root: 262, scale: [0, 4, 7, 9, 12], tempo: 0.5,  wave: 'sine' }
  },

  playTheme(name) {
    if (!this.ctx) return;
    if (this.currentTrack === name) return;
    this.stopMusic();
    this.currentTrack = name;
    const theme = this._themes[name] || this._themes.menu;
    let step = 0;
    const playStep = () => {
      const semis = theme.scale[step % theme.scale.length] + (Math.floor(step / theme.scale.length) % 2) * 12;
      const freq = theme.root * Math.pow(2, semis / 12);
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = theme.wave;
      osc.frequency.value = freq;
      const t0 = this.ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + theme.tempo * 0.9);
      osc.connect(g); g.connect(this.musicGain);
      osc.start(t0); osc.stop(t0 + theme.tempo);
      this.musicNodes.push(osc);
      step++;
    };
    playStep();
    this.musicTimer = setInterval(playStep, theme.tempo * 1000);
  },

  stopMusic() {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
    this.musicNodes = [];
    this.currentTrack = null;
  }
};
