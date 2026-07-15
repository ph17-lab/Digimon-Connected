/*
 * particles.js — lightweight particle pool + screen shake helper.
 * No allocations per frame beyond what's strictly needed; dead particles
 * are spliced out once per update.
 */
'use strict';

class ParticleSystem {
  constructor() { this.particles = []; }

  spawn(opts) {
    this.particles.push({
      x: opts.x, y: opts.y,
      vx: opts.vx || 0, vy: opts.vy || 0,
      gravity: opts.gravity != null ? opts.gravity : 600,
      life: opts.life || 500, age: 0,
      size: opts.size || 4, color: opts.color || '#fff',
      shrink: opts.shrink !== false, fade: opts.fade !== false
    });
  }

  burst(x, y, color, count = 12, opts = {}) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const speed = (opts.speed || 180) * (0.5 + Math.random() * 0.7);
      this.spawn({
        x, y, color,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: opts.life || (400 + Math.random() * 300),
        size: opts.size || (3 + Math.random() * 3),
        gravity: opts.gravity != null ? opts.gravity : 500
      });
    }
  }

  ring(x, y, color, count = 20, radius = 10) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      this.spawn({
        x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius,
        vx: Math.cos(angle) * 90, vy: Math.sin(angle) * 90,
        color, life: 600, size: 5, gravity: 0
      });
    }
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) { this.particles.splice(i, 1); continue; }
      const t = dt / 1000;
      p.vy += p.gravity * t;
      p.x += p.vx * t;
      p.y += p.vy * t;
    }
  }

  draw(ctx, cameraX) {
    for (const p of this.particles) {
      const lifeFrac = 1 - p.age / p.life;
      ctx.globalAlpha = p.fade ? Math.max(0, lifeFrac) : 1;
      const size = p.shrink ? p.size * Math.max(0.15, lifeFrac) : p.size;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x - cameraX, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  clear() { this.particles.length = 0; }
}

class ScreenShake {
  constructor() { this.intensity = 0; this.decay = 0; }
  trigger(intensity, durationMs) {
    this.intensity = Math.max(this.intensity, intensity);
    this.decay = intensity / Math.max(1, durationMs);
  }
  update(dt) {
    if (this.intensity <= 0) { this.intensity = 0; return; }
    this.intensity = Math.max(0, this.intensity - this.decay * dt);
  }
  getOffset() {
    if (this.intensity <= 0) return { x: 0, y: 0 };
    return {
      x: (Math.random() * 2 - 1) * this.intensity,
      y: (Math.random() * 2 - 1) * this.intensity
    };
  }
}
