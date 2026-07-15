/*
 * data.js — static game data: characters, digivolution tree, items, levels.
 * Nothing in this file touches the DOM or canvas; pure data + constants.
 */
'use strict';

const TILE = 40; // px per grid cell, used when authoring level geometry by hand

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------
// Each rookie has one champion evolution (per the request's scope).
// stats: base combat numbers. evoStats: multiplier applied to the rookie's
// current hp/atk while digivolved (bigger + stronger, not a separate curve).
const CHARACTERS = {
  agumon: {
    id: 'agumon', name: 'Agumon', evolvesTo: 'greymon',
    color: '#ff8c2e', accent: '#3a6b2e',
    baseHp: 100, baseSp: 50, baseAtk: 12, baseSpeed: 220, jumpForce: 620,
    specialName: 'Baby Flame', specialCost: 20, specialDamage: 26,
    portraitBg: '#5c2c0c'
  },
  greymon: {
    id: 'greymon', name: 'Greymon', rookieOf: 'agumon',
    color: '#e8792a', accent: '#8a4a12',
    scale: 1.35, atkMult: 2.1, hpMult: 1.6, speedMult: 0.92,
    specialName: 'Nova Blast', specialDamage: 55,
    portraitBg: '#5c2c0c'
  },
  vmon: {
    id: 'vmon', name: 'V-mon', evolvesTo: 'vdramon',
    color: '#2e6bff', accent: '#e8e030',
    baseHp: 90, baseSp: 55, baseAtk: 11, baseSpeed: 250, jumpForce: 660,
    specialName: 'V-Headbutt', specialCost: 18, specialDamage: 24,
    portraitBg: '#0c2c5c'
  },
  vdramon: {
    id: 'vdramon', name: 'V-dramon', rookieOf: 'vmon',
    color: '#1c4fd6', accent: '#f0e850',
    scale: 1.32, atkMult: 2.0, hpMult: 1.55, speedMult: 0.95,
    specialName: 'V-Wing Blade', specialDamage: 52,
    portraitBg: '#0c2c5c'
  },
  guilmon: {
    id: 'guilmon', name: 'Guilmon', evolvesTo: 'growlmon',
    color: '#d8322a', accent: '#1a1a1a',
    baseHp: 105, baseSp: 48, baseAtk: 13, baseSpeed: 210, jumpForce: 600,
    specialName: 'Rock Breaker', specialCost: 22, specialDamage: 28,
    portraitBg: '#3c0c0c'
  },
  growlmon: {
    id: 'growlmon', name: 'Growlmon', rookieOf: 'guilmon',
    color: '#b81a1a', accent: '#141414',
    scale: 1.38, atkMult: 2.15, hpMult: 1.65, speedMult: 0.9,
    specialName: 'Pyro Grenade', specialDamage: 58,
    portraitBg: '#3c0c0c'
  }
};

const STARTERS = ['agumon', 'vmon', 'guilmon'];

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------
const ITEM_DEFS = {
  key_forest:    { name: 'Chave da Floresta', type: 'key', icon: '🗝️' },
  card_city:     { name: 'Cartão de Acesso — Cidade', type: 'card', icon: '💳' },
  key_volcano:   { name: 'Chave Vulcânica', type: 'key', icon: '🔑' },
  quest_crest:   { name: 'Emblema Fragmentado', type: 'mission', icon: '🔯' },
  potion_small:  { name: 'DigiVitamina Pequena', type: 'heal', icon: '🧪', heal: 40 },
  potion_large:  { name: 'DigiVitamina Grande', type: 'heal', icon: '🧴', heal: 90 },
  soul_shard:    { name: 'Fragmento de DigiAlma', type: 'special', icon: '🔮', soul: 30 },
  collectible_1: { name: 'Digi-Cristal Azul', type: 'collectible', icon: '💎' },
  collectible_2: { name: 'Digi-Cristal Verde', type: 'collectible', icon: '💠' },
  collectible_3: { name: 'Digi-Cristal Vermelho', type: 'collectible', icon: '🔺' }
};

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------
// Coordinates are in px. groundY is the default floor top. Platforms are
// AABB rectangles solid on all sides. Camera clamps to [0, width-960].
function rect(x, y, w, h) { return { x, y, w, h }; }

const LEVELS = [
  // ------------------------------------------------------------------ 1
  {
    id: 'forest', name: 'Floresta Digital', order: 0,
    width: 4800, height: 540, groundY: 460,
    sky: ['#7fd0ff', '#bdeaff'], groundColor: '#3c7a2e', groundEdge: '#2a5a20',
    ambient: 'forest',
    platforms: [
      rect(0, 460, 4800, 80),
      rect(420, 360, 160, 24), rect(650, 300, 140, 24),
      rect(900, 380, 200, 24), rect(1250, 320, 140, 24),
      rect(1500, 260, 160, 24), rect(1850, 380, 220, 24),
      rect(2150, 300, 140, 24), rect(2400, 220, 160, 24),
      rect(2700, 380, 200, 24), rect(3000, 300, 140, 24),
      rect(3300, 360, 220, 24), rect(3650, 260, 160, 24),
      rect(3950, 380, 200, 24), rect(4300, 320, 220, 24)
    ],
    traps: [
      rect(780, 436, 80, 24, 'spike'), rect(1720, 436, 100, 24, 'spike'),
      rect(2560, 436, 80, 24, 'spike'), rect(3200, 436, 100, 24, 'spike'),
      rect(4120, 436, 80, 24, 'spike')
    ].map(t => ({ x: t.x, y: t.y, w: t.w, h: t.h, type: 'spike' })),
    checkpoints: [ {x: 100, y: 400}, {x: 1550, y: 200}, {x: 2450, y: 160}, {x: 3700, y: 200} ],
    enemies: [
      { x: 600, y: 420, type: 'kunemon' }, { x: 980, y: 340, type: 'kunemon' },
      { x: 1600, y: 220, type: 'goblimon' }, { x: 1950, y: 420, type: 'kunemon' },
      { x: 2450, y: 180, type: 'goblimon' }, { x: 2780, y: 340, type: 'kunemon' },
      { x: 3400, y: 320, type: 'goblimon' }, { x: 4000, y: 340, type: 'kunemon' }
    ],
    items: [
      { x: 700, y: 260, id: 'potion_small' }, { x: 1550, y: 220, id: 'key_forest' },
      { x: 2440, y: 180, id: 'collectible_1' }, { x: 3680, y: 220, id: 'soul_shard' }
    ],
    secret: { area: rect(4450, 200, 240, 260), trigger: rect(4400, 420, 60, 40), itemId: 'potion_large', hint: 'Área secreta na copa das árvores' },
    door: { x: 4700, y: 340, w: 60, h: 120, requiresItem: 'key_forest' },
    boss: { x: 4550, y: 340, type: 'boss_forest', name: 'Woodmon Corrompido' }
  },
  // ------------------------------------------------------------------ 2
  {
    id: 'city', name: 'Cidade dos Dados', order: 1,
    width: 5200, height: 540, groundY: 470,
    sky: ['#1b2340', '#3a4a7a'], groundColor: '#2a2f4a', groundEdge: '#171a2c',
    ambient: 'city',
    platforms: [
      rect(0, 470, 5200, 70),
      rect(360, 380, 180, 24), rect(620, 320, 160, 24), rect(900, 260, 140, 24),
      rect(1200, 380, 200, 24), rect(1500, 300, 160, 24), rect(1800, 220, 140, 24),
      rect(2100, 360, 220, 24), rect(2450, 300, 160, 24), rect(2750, 220, 140, 24),
      rect(3050, 380, 200, 24), rect(3400, 300, 160, 24), rect(3700, 240, 140, 24),
      rect(4000, 360, 220, 24), rect(4350, 280, 160, 24), rect(4650, 380, 220, 24)
    ],
    traps: [
      rect(820, 446, 90, 24, 'spike'), rect(1980, 446, 100, 24, 'spike'),
      rect(2900, 446, 90, 24, 'spike'), rect(3900, 446, 100, 24, 'spike'),
      rect(4560, 446, 90, 24, 'spike')
    ].map(t => ({ x: t.x, y: t.y, w: t.w, h: t.h, type: 'spike' })),
    checkpoints: [ {x: 100, y: 410}, {x: 1550, y: 240}, {x: 2780, y: 160}, {x: 4050, y: 200} ],
    enemies: [
      { x: 640, y: 280, type: 'bakemon' }, { x: 1000, y: 220, type: 'bakemon' },
      { x: 1550, y: 260, type: 'tankmon' }, { x: 2150, y: 320, type: 'bakemon' },
      { x: 2780, y: 180, type: 'tankmon' }, { x: 3450, y: 260, type: 'bakemon' },
      { x: 4050, y: 320, type: 'tankmon' }, { x: 4680, y: 340, type: 'bakemon' }
    ],
    items: [
      { x: 920, y: 220, id: 'potion_small' }, { x: 1820, y: 180, id: 'card_city' },
      { x: 2770, y: 180, id: 'collectible_2' }, { x: 4370, y: 240, id: 'soul_shard' }
    ],
    secret: { area: rect(4900, 180, 260, 280), trigger: rect(4850, 440, 60, 40), itemId: 'potion_large', hint: 'Servidor oculto atrás do letreiro' },
    door: { x: 5100, y: 350, w: 60, h: 120, requiresItem: 'card_city' },
    boss: { x: 4950, y: 350, type: 'boss_city', name: 'Vilemon Hacker' }
  },
  // ------------------------------------------------------------------ 3
  {
    id: 'volcano', name: 'Montanha de Lava', order: 2,
    width: 5000, height: 540, groundY: 460,
    sky: ['#3a0f0a', '#7a2a12'], groundColor: '#3a2018', groundEdge: '#1a0d08',
    ambient: 'volcano',
    platforms: [
      rect(0, 460, 900, 80), rect(1000, 460, 400, 80), rect(1520, 460, 380, 80),
      rect(2020, 460, 420, 80), rect(2560, 460, 380, 80), rect(3060, 460, 420, 80),
      rect(3600, 460, 380, 80), rect(4100, 460, 900, 80),
      rect(300, 340, 160, 24), rect(560, 260, 140, 24), rect(1080, 360, 160, 24),
      rect(1620, 320, 140, 24), rect(2100, 340, 200, 24), rect(2620, 280, 160, 24),
      rect(3120, 340, 200, 24), rect(3650, 300, 160, 24), rect(4200, 340, 220, 24)
    ],
    traps: [
      rect(900, 420, 100, 40, 'lava'), rect(1400, 420, 120, 40, 'lava'),
      rect(1900, 420, 120, 40, 'lava'), rect(2440, 420, 120, 40, 'lava'),
      rect(2940, 420, 120, 40, 'lava'), rect(3480, 420, 120, 40, 'lava'),
      rect(3980, 420, 120, 40, 'lava')
    ],
    checkpoints: [ {x: 100, y: 400}, {x: 1650, y: 260}, {x: 2650, y: 220}, {x: 3680, y: 240} ],
    enemies: [
      { x: 350, y: 300, type: 'goblimon' }, { x: 1100, y: 320, type: 'tankmon' },
      { x: 1650, y: 280, type: 'goblimon' }, { x: 2150, y: 300, type: 'bakemon' },
      { x: 2650, y: 240, type: 'tankmon' }, { x: 3150, y: 300, type: 'goblimon' },
      { x: 3680, y: 260, type: 'bakemon' }, { x: 4250, y: 300, type: 'tankmon' }
    ],
    items: [
      { x: 600, y: 220, id: 'potion_large' }, { x: 1650, y: 280, id: 'key_volcano' },
      { x: 2660, y: 240, id: 'collectible_3' }, { x: 3680, y: 260, id: 'soul_shard' }
    ],
    secret: { area: rect(4400, 180, 260, 260), trigger: rect(4350, 440, 60, 40), itemId: 'quest_crest', hint: 'Câmara de magma escondida' },
    door: { x: 4850, y: 340, w: 60, h: 120, requiresItem: 'key_volcano' },
    boss: { x: 4700, y: 340, type: 'boss_volcano', name: 'Meramon Furioso' }
  },
  // ------------------------------------------------------------------ 4
  {
    id: 'castle', name: 'Castelo do Chefe Final', order: 3,
    width: 3600, height: 540, groundY: 460,
    sky: ['#120a1e', '#301a3a'], groundColor: '#2a1a3a', groundEdge: '#150a1e',
    ambient: 'castle',
    platforms: [
      rect(0, 460, 3600, 80),
      rect(400, 380, 180, 24), rect(700, 300, 160, 24), rect(1020, 380, 200, 24),
      rect(1350, 300, 160, 24), rect(1650, 220, 180, 24), rect(2000, 340, 220, 24),
      rect(2350, 260, 160, 24), rect(2650, 340, 200, 24), rect(2950, 260, 180, 24)
    ],
    traps: [
      rect(880, 436, 90, 24, 'spike'), rect(1580, 436, 100, 24, 'spike'),
      rect(2250, 436, 90, 24, 'spike'), rect(2850, 436, 100, 24, 'spike')
    ].map(t => ({ x: t.x, y: t.y, w: t.w, h: t.h, type: 'spike' })),
    checkpoints: [ {x: 100, y: 400}, {x: 1400, y: 260}, {x: 2400, y: 220} ],
    enemies: [
      { x: 750, y: 260, type: 'tankmon' }, { x: 1080, y: 340, type: 'bakemon' },
      { x: 1700, y: 180, type: 'tankmon' }, { x: 2050, y: 300, type: 'bakemon' },
      { x: 2400, y: 220, type: 'tankmon' }, { x: 2700, y: 300, type: 'bakemon' }
    ],
    items: [
      { x: 1400, y: 260, id: 'potion_large' }, { x: 2360, y: 220, id: 'quest_crest' }
    ],
    secret: { area: rect(3150, 200, 260, 260), trigger: rect(3100, 440, 60, 40), itemId: 'soul_shard', hint: 'Sacristia esquecida' },
    door: { x: 3480, y: 340, w: 60, h: 120, requiresItem: 'quest_crest' },
    boss: { x: 3350, y: 300, type: 'boss_final', name: 'Devimon' }
  }
];

// ---------------------------------------------------------------------------
// Enemy definitions (grunts)
// ---------------------------------------------------------------------------
const ENEMY_DEFS = {
  kunemon:  { name: 'Kunemon',  hp: 30, atk: 6,  speed: 70,  color: '#7a4bb0', w: 44, h: 34, expReward: 12, soulReward: 12, behavior: 'patrol' },
  goblimon: { name: 'Goblimon', hp: 46, atk: 9,  speed: 90,  color: '#8a6a3a', w: 44, h: 56, expReward: 18, soulReward: 16, behavior: 'chase' },
  bakemon:  { name: 'Bakemon',  hp: 38, atk: 8,  speed: 110, color: '#d8d8f0', w: 42, h: 58, expReward: 16, soulReward: 15, behavior: 'chase' },
  tankmon:  { name: 'Tankmon',  hp: 70, atk: 12, speed: 55,  color: '#5a6a7a', w: 56, h: 60, expReward: 26, soulReward: 22, behavior: 'patrol' }
};

const BOSS_DEFS = {
  boss_forest: { name: 'Woodmon Corrompido', hp: 260, atk: 16, speed: 80,  color: '#4a3a1a', w: 90, h: 110, expReward: 200 },
  boss_city:   { name: 'Vilemon Hacker',     hp: 320, atk: 18, speed: 110, color: '#2a1a4a', w: 84, h: 100, expReward: 260 },
  boss_volcano:{ name: 'Meramon Furioso',    hp: 380, atk: 20, speed: 95,  color: '#c8401a', w: 90, h: 116, expReward: 320 },
  boss_final:  { name: 'Devimon',            hp: 500, atk: 24, speed: 100, color: '#1a0a2a', w: 96, h: 130, expReward: 500 }
};

// ---------------------------------------------------------------------------
// Progression constants
// ---------------------------------------------------------------------------
const DIGISOUL_MAX = 100;
const EVOLUTION_DURATION = 18000; // ms the champion form lasts before reverting
const EXP_PER_LEVEL = 100; // flat curve: level * EXP_PER_LEVEL to level up
const HIT_INVULN_MS = 900;
const EVOLVE_INVULN_MS = 1500;

if (typeof module !== 'undefined') {
  module.exports = { CHARACTERS, STARTERS, ITEM_DEFS, LEVELS, ENEMY_DEFS, BOSS_DEFS, TILE };
}
