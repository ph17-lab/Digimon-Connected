/*
 * main.js — bootstrap: wire up the canvas, load real sprite/HUD assets,
 * initialize UI + input, and start the render loop.
 */
'use strict';

window.addEventListener('DOMContentLoaded', async () => {
  const canvas = document.getElementById('game');
  Game.init(canvas);
  UI.init();
  Game.resize();
  window.addEventListener('resize', () => Game.resize());
  window.addEventListener('orientationchange', () => Game.resize());
  Game.start();
  await Assets.loadAll();
});
