/*
 * entities.js — Player, Enemy, Boss: physics, combat, AI, digivolution.
 * Entities use a bottom-center (x, y) position convention so it lines up
 * with how sprites.js anchors and draws frames.
 */
'use strict';

const GRAVITY = 1850;           // lighter gravity = floatier, more readable jumps
const MAX_FALL_SPEED = 980;
const MOVE_SMOOTH_GROUND = 14;  // exponential approach rates for velocity
const MOVE_SMOOTH_AIR = 10;

function getAABB(e) { return { x: e.x - e.width / 2, y: e.y - e.height, w: e.width, h: e.height }; }
function rectsOverlap(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

function moveAndCollide(entity, dx, dy, solids) {
  entity.x += dx;
  let box = getAABB(entity);
  for (const r of solids) {
    if (rectsOverlap(box, r)) {
      if (dx > 0) entity.x = r.x - entity.width / 2 - 0.01;
      else if (dx < 0) entity.x = r.x + r.w + entity.width / 2 + 0.01;
      box = getAABB(entity);
    }
  }

  // Y axis: resolve using the entity's position BEFORE this move so we can
  // tell "landing on top" from "hitting head on the underside" even when a
  // platform's clearance is tighter than the entity's own height — a plain
  // post-move-overlap check would otherwise yank the entity onto whichever
  // solid it ends up overlapping, regardless of which side it approached from.
  const prevFeetY = entity.y;
  const prevHeadY = entity.y - entity.height;
  entity.y += dy;
  entity.grounded = false;
  box = getAABB(entity);
  for (const r of solids) {
    if (rectsOverlap(box, r)) {
      if (dy >= 0 && prevFeetY <= r.y + 0.5) {
        entity.y = r.y; entity.grounded = true; entity.vy = 0;
      } else if (dy <= 0 && prevHeadY >= r.y + r.h - 0.5) {
        entity.y = r.y + r.h + entity.height; entity.vy = 0;
      } else {
        continue; // can't cleanly resolve (tighter clearance than entity height) — ignore
      }
      box = getAABB(entity);
    }
  }
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
class Player {
  constructor(rookieId, x, y) {
    this.rookieId = rookieId;
    this.charId = rookieId;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.facing = 1;
    this.grounded = false;
    this.width = 42; this.height = 96;
    this.sprite = getSpriteAnimator(rookieId);
    this.state = 'idle';

    this._applyStatsForForm(rookieId, true);

    this.level = 1; this.exp = 0;
    this.digiSoul = 0;
    this.evolved = false; this.evolveTimer = 0;
    this.invulnTimer = 0;
    this.evolveInvulnTimer = 0;
    this.attackState = null;       // 'attack1' | 'attack2' | 'special' | null
    this.attackTimer = 0;
    this.attackDuration = 0;
    this.attackHitEnemies = new Set();
    this.comboWindow = 0;
    this.queuedCombo = false;
    this.dead = false;
    this.inventory = [];
    this.collectedItemIds = new Set();
    this.defeatedBosses = new Set();
    this.unlockedSecrets = new Set();
    this.facingLockTimer = 0;
    this.hurtTimer = 0;
    this.knockbackX = 0;
  }

  _applyStatsForForm(charId, isInit) {
    const def = CHARACTERS[charId];
    this.charId = charId;
    if (isInit) {
      this.maxHp = def.baseHp; this.hp = this.maxHp;
      this.maxSp = def.baseSp; this.sp = this.maxSp;
    }
    this.baseAtk = def.baseAtk || this.baseAtk;
    this.baseSpeed = def.baseSpeed || this.baseSpeed;
    this.baseJump = def.jumpForce || this.baseJump;
    this.sprite = getSpriteAnimator(charId);
  }

  get speed() { return this.evolved ? this.baseSpeed * (CHARACTERS[this.charId].speedMult || 1) : this.baseSpeed; }
  get jumpForce() { return this.baseJump; }
  get atk() {
    if (!this.evolved) return this.baseAtk + (this.level - 1) * 1.4;
    return this.baseAtk * (CHARACTERS[this.charId].atkMult || 2) + (this.level - 1) * 1.4;
  }
  get scale() { return this.evolved ? (CHARACTERS[this.charId].scale || 1.35) : 1; }
  get isInvulnerable() { return this.invulnTimer > 0 || this.evolveInvulnTimer > 0; }

  expToNextLevel() { return this.level * EXP_PER_LEVEL; }

  gainExp(amount) {
    this.exp += amount;
    while (this.exp >= this.expToNextLevel()) {
      this.exp -= this.expToNextLevel();
      this.level++;
      this.maxHp += 12;
      this.maxSp += 6;
      this.hp = this.maxHp;
      this.sp = this.maxSp;
    }
  }

  gainDigiSoul(amount) {
    if (this.evolved) return;
    this.digiSoul = Math.min(DIGISOUL_MAX, this.digiSoul + amount);
  }

  canEvolve() { return !this.evolved && this.digiSoul >= DIGISOUL_MAX; }

  evolve(particles, shake) {
    if (!this.canEvolve()) return false;
    const rookieDef = CHARACTERS[this.rookieId];
    const champId = rookieDef.evolvesTo;
    this.evolved = true;
    this.charId = champId;
    this.sprite = getSpriteAnimator(champId);
    const champDef = CHARACTERS[champId];
    const hpFrac = this.hp / this.maxHp;
    this.maxHp = Math.round(this.maxHp * (champDef.hpMult || 1.5));
    this.hp = Math.round(this.maxHp * hpFrac + this.maxHp * 0.15);
    if (this.hp > this.maxHp) this.hp = this.maxHp;
    this.digiSoul = 0;
    this.evolveTimer = EVOLUTION_DURATION;
    this.evolveInvulnTimer = EVOLVE_INVULN_MS;
    if (particles) particles.burst(this.x, this.y - this.height / 2, champDef.color, 40, { speed: 260, life: 700 });
    if (shake) shake.trigger(14, 500);
    return true;
  }

  revert() {
    if (!this.evolved) return;
    this.evolved = false;
    this.charId = this.rookieId;
    this.sprite = getSpriteAnimator(this.rookieId);
    const rookieDef = CHARACTERS[this.rookieId];
    this.maxHp = Math.max(rookieDef.baseHp, Math.round(this.maxHp / (CHARACTERS[rookieDef.evolvesTo].hpMult || 1.5)));
    this.hp = Math.min(this.hp, this.maxHp);
    this.evolveTimer = 0;
  }

  takeDamage(amount, knockbackDir, particles, shake) {
    if (this.isInvulnerable || this.dead) return;
    this.hp = Math.max(0, this.hp - amount);
    this.invulnTimer = HIT_INVULN_MS;
    this.hurtTimer = 260;
    this.vy = -260;
    this.knockbackX = knockbackDir * 320;
    if (typeof Game !== 'undefined' && Game.addText) {
      Game.addText(this.x, this.y - this.height - 14, '-' + Math.round(amount), '#e5484d');
    }
    if (particles) particles.burst(this.x, this.y - this.height * 0.6, '#ff4040', 8, { speed: 140, life: 300 });
    if (shake) shake.trigger(6, 180);
    if (AudioSys) AudioSys.sfx('hurt');
    if (this.hp <= 0) this.dead = true;
  }

  tryAttack(kind) {
    if (this.attackState || this.dead) return false;
    if (kind === 'special') {
      const def = CHARACTERS[this.rookieId];
      if (this.sp < def.specialCost) return false;
      this.sp -= def.specialCost;
      this.attackState = 'special';
      this.attackDuration = 560;
      this._specialFired = false;
    } else {
      this.attackState = 'attack1';
      this.attackDuration = 300;
    }
    this.attackTimer = 0;
    this.attackHitEnemies.clear();
    this.sprite.setState(this.attackState, { force: true, frameMs: null });
    AudioSys.sfx(this.attackState === 'special' ? 'special' : 'attack1');
    return true;
  }

  getAttackHitbox() {
    if (!this.attackState) return null;
    if (this.attackState === 'special') return null; // damage comes from the projectile
    const progress = this.attackTimer / this.attackDuration;
    if (progress < 0.25 || progress > 0.95) return null; // startup/recovery: no hitbox
    const range = this.attackState === 'attack2' ? 70 : 58;
    const h = this.height * 0.75;
    const w = range * this.scale;
    const x = this.facing === 1 ? this.x : this.x - w;
    const y = this.y - h - this.height * 0.05;
    return { x, y, w, h };
  }

  getAttackDamage() {
    const def = CHARACTERS[this.rookieId];
    if (this.attackState === 'special') return (this.evolved ? CHARACTERS[this.charId].specialDamage : def.specialDamage);
    if (this.attackState === 'attack2') return this.atk * 1.6;
    return this.atk;
  }

  handleInput(inp) {
    if (this.dead) return;
    const moveDir = (inp.isDown('right') ? 1 : 0) - (inp.isDown('left') ? 1 : 0);
    this._moveDir = moveDir;
    if (moveDir !== 0) this.facing = moveDir;

    if (inp.pressed('jump') && this.grounded && !this.attackState) {
      this.vy = -this.jumpForce;
      this.grounded = false;
      AudioSys.sfx('jump');
    }
    this._jumpHeld = inp.isDown('jump');
    if (inp.pressed('attack')) {
      if (this.attackState === 'attack1' && this.attackTimer / this.attackDuration > 0.55) {
        this.queuedCombo = true;
      } else if (!this.attackState) {
        this.tryAttack('attack1');
      }
    }
    if (inp.pressed('special')) this.tryAttack('special');
  }

  update(dt, solids, particles, shake) {
    if (this.dead) { this.vy += GRAVITY * dt / 1000; return; }
    const dtS = dt / 1000;

    // horizontal movement: exponential approach toward the target velocity —
    // smooth ramp-up and glide-to-stop instead of a hard linear clamp.
    // Attacking on the ground slows you to 25% instead of freezing you;
    // air attacks keep full control.
    const attackFactor = this.attackState ? (this.grounded ? 0.25 : 1) : 1;
    const targetVx = (this._moveDir || 0) * this.speed * attackFactor;
    if (this.knockbackX !== 0) {
      this.vx = this.knockbackX;
      this.knockbackX *= 0.85;
      if (Math.abs(this.knockbackX) < 10) this.knockbackX = 0;
    } else {
      const rate = this.grounded ? MOVE_SMOOTH_GROUND : MOVE_SMOOTH_AIR;
      this.vx += (targetVx - this.vx) * Math.min(1, dtS * rate);
      if (Math.abs(this.vx) < 2 && targetVx === 0) this.vx = 0;
    }

    // variable jump height: releasing the button early cuts the ascent short
    if (this.vy < -300 && !this._jumpHeld) this.vy = -300;

    this.vy = Math.min(MAX_FALL_SPEED, this.vy + GRAVITY * dtS);
    moveAndCollide(this, this.vx * dtS, this.vy * dtS, solids);

    // timers
    if (this.invulnTimer > 0) this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    if (this.evolveInvulnTimer > 0) this.evolveInvulnTimer = Math.max(0, this.evolveInvulnTimer - dt);
    if (this.hurtTimer > 0) this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    if (this.sp < this.maxSp) this.sp = Math.min(this.maxSp, this.sp + dtS * (this.maxSp * 0.04));

    if (this.evolved) {
      this.evolveTimer -= dt;
      if (this.evolveTimer <= 0) this.revert();
    }

    if (this.attackState) {
      this.attackTimer += dt;
      // launch the special's projectile once the cast animation reaches the
      // release pose (~60% in) — game.js drains pendingProjectile each frame
      if (this.attackState === 'special' && !this._specialFired &&
          this.attackTimer >= this.attackDuration * 0.6) {
        this._specialFired = true;
        const def = CHARACTERS[this.charId];
        this.pendingProjectile = {
          charId: this.charId,
          x: this.x + this.facing * (this.width * 0.5 + 20),
          y: this.y - this.height * 0.45, // chest height: clears platforms above, still hits short enemies

          vx: this.facing * (def.projSpeed || 520),
          life: def.projLife || 1500,
          damage: def.specialDamage || CHARACTERS[this.rookieId].specialDamage,
          scale: this.scale
        };
      }
      if (this.attackTimer >= this.attackDuration) {
        if (this.attackState === 'attack1' && this.queuedCombo) {
          this.queuedCombo = false;
          this.attackState = 'attack2';
          this.attackTimer = 0;
          this.attackDuration = 360;
          this.attackHitEnemies.clear();
          this.sprite.setState('attack2', { force: true });
          AudioSys.sfx('attack2');
        } else {
          this.attackState = null;
          this.queuedCombo = false;
        }
      }
    }

    // animation state selection
    let animState = 'idle';
    if (this.attackState) animState = this.attackState;
    else if (!this.grounded) animState = this.vy < 0 ? 'jump' : 'fall';
    else if (Math.abs(this.vx) > 20) animState = 'walk';
    this.sprite.setState(animState);
    this.sprite.update(dt);
  }

  draw(ctx, cameraX) {
    const blink = this.invulnTimer > 0 && Math.floor(this.invulnTimer / 90) % 2 === 0;
    if (blink) return;
    this.sprite.draw(ctx, this.x - cameraX, this.y, this.facing, this.scale, {
      hitFlash: this.hurtTimer > 0,
      glow: this.evolveInvulnTimer > 0 ? 22 : 0
    });
  }
}

// ---------------------------------------------------------------------------
// Enemy
// ---------------------------------------------------------------------------
class Enemy {
  constructor(type, x, y, defsTable = ENEMY_DEFS) {
    this.type = type;
    const def = defsTable[type];
    this.def = def;
    this.name = def.name;
    this.x = x; this.y = y;
    this.spawnX = x;
    this.vx = 0; this.vy = 0;
    this.width = def.w; this.height = def.h;
    this.hp = def.hp; this.maxHp = def.hp;
    this.facing = -1;
    this.grounded = false;
    this.dead = false;
    this.deathTimer = 0;
    this.hurtTimer = 0;
    this.attackCooldown = 0;
    this.patrolDir = 1;
    this.patrolRange = 130;
    this.anim = Math.random() * 10;      // continuous animation clock (seconds*6)
    this.phase = Math.random() * Math.PI * 2;
    this.baseY = def.fly ? y - 84 : y;   // hover altitude for flying enemies
    this.projectiles = [];
    this.rangedCd = 1200 + Math.random() * 1200;
  }

  takeDamage(amount, knockbackDir, particles) {
    if (this.dead) return;
    this.hp -= amount;
    this.hurtTimer = 200;
    this.vx = knockbackDir * 220;
    if (particles) particles.burst(this.x, this.y - this.height / 2, '#fff', 6, { speed: 120, life: 250 });
    if (this.hp <= 0) {
      this.dead = true;
      this.deathTimer = 400;
      AudioSys.sfx('enemyDeath');
    } else {
      AudioSys.sfx('hit');
    }
  }

  update(dt, solids, player, particles) {
    if (this.dead) {
      this.deathTimer -= dt;
      return;
    }
    const dtS = dt / 1000;
    this.anim += dtS * 6;
    this.phase += dtS * 2;
    const dx = player.x - this.x;
    const dist = Math.abs(dx);

    if (this.def.fly) {
      // hover with a sine bob; drift toward the player when in range
      const targetY = this.baseY + Math.sin(this.phase) * 26;
      this.y += (targetY - this.y) * Math.min(1, dtS * 3);
      if (this.hurtTimer > 0) {
        this.hurtTimer -= dt;
        this.vx *= 0.9;
        this.x += this.vx * dtS;
      } else if (dist > 70 && dist < 460) {
        this.facing = dx > 0 ? 1 : -1;
        this.x += this.facing * this.def.speed * dtS;
      } else if (dist >= 460) {
        this.x += Math.sin(this.phase * 0.5) * this.def.speed * 0.35 * dtS;
      }
    } else {
      this.vy = Math.min(MAX_FALL_SPEED, this.vy + GRAVITY * dtS);
      if (this.hurtTimer > 0) {
        this.hurtTimer -= dt;
        this.vx *= 0.9;
      } else if (this.def.behavior === 'chase' && dist < 380 && Math.abs(player.y - this.y) < 140) {
        this.facing = dx > 0 ? 1 : -1;
        this.vx = this.facing * this.def.speed;
      } else {
        if (this.x > this.spawnX + this.patrolRange) this.patrolDir = -1;
        else if (this.x < this.spawnX - this.patrolRange) this.patrolDir = 1;
        this.facing = this.patrolDir;
        this.vx = this.patrolDir * this.def.speed * 0.6;
      }
      moveAndCollide(this, this.vx * dtS, this.vy * dtS, solids);
    }

    // contact damage
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (dist < 46 && Math.abs(player.y - this.y) < 100 && this.attackCooldown <= 0 && !player.isInvulnerable) {
      player.takeDamage(this.def.atk, dx > 0 ? -1 : 1, particles);
      this.attackCooldown = 900;
    }

    // ranged attack (flying ghosts, tank shells, phase-2 bosses)
    if (this.def.ranged && this.hurtTimer <= 0) {
      this.rangedCd -= dt;
      const vRange = this.def.fly ? 300 : 190; // fliers lob down from above
      if (this.rangedCd <= 0 && dist < 470 && Math.abs(player.y - this.y) < vRange) {
        this.rangedCd = this.def.fireInterval || 2500;
        this.facing = dx > 0 ? 1 : -1;
        const py = this.y - this.height * 0.55;
        const targetY = player.y - player.height * 0.5;
        this.projectiles.push({
          x: this.x + this.facing * this.width * 0.4, y: py,
          vx: this.facing * (this.def.projSpeed || 280),
          vy: this.def.fly ? (targetY - py) * 0.55 : 0,
          life: 2400
        });
      }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.x += p.vx * dtS;
      p.y += p.vy * dtS;
      p.life -= dt;
      if (p.life <= 0) { this.projectiles.splice(i, 1); continue; }
      if (!player.isInvulnerable &&
          Math.abs(p.x - player.x) < 24 &&
          Math.abs(p.y - (player.y - player.height / 2)) < player.height * 0.55) {
        player.takeDamage(this.def.atk * 0.75, p.vx > 0 ? 1 : -1, particles);
        this.projectiles.splice(i, 1);
      }
    }
  }

  draw(ctx, cameraX) {
    if (this.dead && this.deathTimer <= 0) return;
    const x = this.x - cameraX, y = this.y;

    // enemy projectiles (dark orbs / shells)
    for (const p of this.projectiles) {
      const px = p.x - cameraX;
      ctx.fillStyle = this.def.projColor || '#b060ff';
      ctx.beginPath(); ctx.arc(px, p.y, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(px - p.vx * 0.008, p.y, 4, 0, Math.PI * 2); ctx.fill();
    }

    ctx.save();
    if (this.dead) ctx.globalAlpha = Math.max(0, this.deathTimer / 400);
    if (this.hurtTimer > 0) ctx.filter = 'brightness(2)';
    ctx.translate(x, y);
    ctx.scale(this.facing, 1);
    this._drawBody(ctx);
    ctx.restore();

    if (!this.dead) {
      const bw = this.width;
      const bx = x - bw / 2, by = y - this.height - 14;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(bx, by, bw, 5);
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(bx, by, bw * Math.max(0, this.hp / this.maxHp), 5);
    }
  }

  // animated procedural body, one distinctive look per enemy type
  _drawBody(ctx) {
    const w = this.width, h = this.height;
    const c = this.def.color;
    const walk = Math.sin(this.anim * 2.2);       // gait oscillator
    const bob = Math.sin(this.anim * 1.4) * 2;

    if (this.type === 'kunemon') {
      // caterpillar: three squashy segments + antennae
      const squash = 1 + Math.sin(this.anim * 3) * 0.08;
      ctx.fillStyle = c;
      for (let s = 0; s < 3; s++) {
        const sx = -w * 0.3 + s * w * 0.3;
        const r = (h * 0.42 + (s === 2 ? 3 : 0)) * squash;
        ctx.beginPath(); ctx.ellipse(sx, -r * 0.9 + Math.sin(this.anim * 3 + s) * 2, r, r * 0.9, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = '#d8d840'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w * 0.28, -h * 0.8); ctx.lineTo(w * 0.4, -h - 6 + bob);
      ctx.moveTo(w * 0.34, -h * 0.78); ctx.lineTo(w * 0.5, -h - 2 + bob);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(w * 0.3, -h * 0.66, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#301848';
      ctx.beginPath(); ctx.arc(w * 0.32, -h * 0.66, 2.4, 0, Math.PI * 2); ctx.fill();
    } else if (this.type === 'goblimon') {
      // goblin: waddling legs, round body, horn, swinging club
      const step = walk * 5;
      ctx.fillStyle = '#5a4428';
      ctx.fillRect(-w * 0.26 + step, -h * 0.22, 9, h * 0.22);
      ctx.fillRect(w * 0.08 - step, -h * 0.22, 9, h * 0.22);
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.ellipse(0, -h * 0.55 + bob, w * 0.42, h * 0.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(w * 0.08, -h * 0.88 + bob, w * 0.26, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e8e0d0';
      ctx.beginPath();
      ctx.moveTo(w * 0.02, -h * 1.05 + bob); ctx.lineTo(w * 0.1, -h * 1.28 + bob); ctx.lineTo(w * 0.18, -h * 1.02 + bob);
      ctx.closePath(); ctx.fill();
      // club arm swings with the gait
      ctx.save();
      ctx.translate(w * 0.3, -h * 0.62 + bob);
      ctx.rotate(walk * 0.35 + 0.5);
      ctx.fillStyle = '#7a5c34'; ctx.fillRect(-3, -4, 30, 7);
      ctx.fillStyle = '#8a6a3a';
      ctx.beginPath(); ctx.arc(30, 0, 9, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath(); ctx.arc(w * 0.16, -h * 0.9 + bob, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#301810';
      ctx.beginPath(); ctx.arc(w * 0.18, -h * 0.9 + bob, 2, 0, Math.PI * 2); ctx.fill();
    } else if (this.type === 'bakemon') {
      // ghost: floating sheet with a wavy hem, hollow eyes, open mouth
      const hem = this.anim * 4;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(0, -h * 0.62, w * 0.46, Math.PI, 0);
      const hemY = -h * 0.18;
      ctx.lineTo(w * 0.46, hemY);
      for (let i = 3; i >= -3; i--) {
        const hx = (i / 3) * w * 0.46;
        ctx.quadraticCurveTo(hx + w * 0.07, hemY + 10 + Math.sin(hem + i) * 5, hx, hemY + 4 + Math.sin(hem + i * 2) * 4);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#241a30';
      ctx.beginPath(); ctx.ellipse(w * 0.12, -h * 0.72, 6, 9, 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-w * 0.14, -h * 0.72, 6, 9, -0.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, -h * 0.45, 10, 7 + Math.sin(this.anim * 3) * 3, 0, 0, Math.PI * 2); ctx.fill();
    } else if (this.type === 'tankmon') {
      // tank: animated treads, hull, dome, cannon
      ctx.fillStyle = '#3a4250';
      roundRectPath(ctx, -w * 0.5, -h * 0.3, w, h * 0.3, 8); ctx.fill();
      ctx.fillStyle = '#20262e';
      const treadOff = (this.anim * 30) % 14;
      for (let tx = -w * 0.5 + 4 - treadOff; tx < w * 0.5; tx += 14) {
        if (tx > -w * 0.5) ctx.fillRect(tx, -h * 0.26, 5, h * 0.2);
      }
      ctx.fillStyle = c;
      roundRectPath(ctx, -w * 0.42, -h * 0.68, w * 0.84, h * 0.42, 6); ctx.fill();
      ctx.beginPath(); ctx.arc(0, -h * 0.72, w * 0.24, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#2a3038';
      ctx.fillRect(w * 0.2, -h * 0.62 + Math.sin(this.anim) * 1.5, w * 0.42, 8);
      ctx.fillStyle = '#ff5040';
      ctx.beginPath(); ctx.arc(w * 0.06, -h * 0.76, 4, 0, Math.PI * 2); ctx.fill();
    } else {
      // bosses / fallback: hulking silhouette with horns and glowing eyes
      const breathe = 1 + Math.sin(this.anim) * 0.03;
      ctx.fillStyle = c;
      roundRectPath(ctx, -w / 2, -h * breathe, w, h * breathe, 10); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      roundRectPath(ctx, -w / 2, -h * breathe, w, h * 0.34, 8); ctx.fill();
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(-w * 0.34, -h * breathe); ctx.lineTo(-w * 0.44, -h * breathe - 20); ctx.lineTo(-w * 0.2, -h * breathe + 2);
      ctx.moveTo(w * 0.34, -h * breathe); ctx.lineTo(w * 0.44, -h * breathe - 20); ctx.lineTo(w * 0.2, -h * breathe + 2);
      ctx.closePath(); ctx.fill();
      const glow = 0.7 + Math.sin(this.anim * 2.5) * 0.3;
      ctx.fillStyle = `rgba(255,60,60,${glow})`;
      ctx.beginPath(); ctx.arc(w * 0.14, -h * 0.8, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-w * 0.1, -h * 0.8, 5, 0, Math.PI * 2); ctx.fill();
      const step = walk * 4;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(-w * 0.3 + step, -h * 0.16, w * 0.2, h * 0.16);
      ctx.fillRect(w * 0.1 - step, -h * 0.16, w * 0.2, h * 0.16);
    }
  }
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Boss (multi-phase Enemy)
// ---------------------------------------------------------------------------
class Boss extends Enemy {
  constructor(type, x, y) {
    super(type, x, y, BOSS_DEFS);
    const def = BOSS_DEFS[type];
    this.def = { ...def, behavior: 'chase', projColor: '#ff5030', projSpeed: 300, fireInterval: 1800 };
    this.hp = def.hp; this.maxHp = def.hp;
    this.bossPhase = 1;   // battle phase (Enemy.phase is the animation oscillator)
    this.isBoss = true;
    this.roared = false;
  }

  update(dt, solids, player, particles) {
    if (!this.roared) { this.roared = true; AudioSys.sfx('bossRoar'); }
    if (this.hp / this.maxHp <= 0.5 && this.bossPhase === 1) {
      // fury: faster and starts firing (Enemy.update handles the ranged loop)
      this.bossPhase = 2;
      this.def = { ...this.def, speed: this.def.speed * 1.3, ranged: true };
      AudioSys.sfx('bossRoar');
    }
    super.update(dt, solids, player, particles);
  }
}
