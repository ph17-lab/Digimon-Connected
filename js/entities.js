/*
 * entities.js — Player, Enemy, Boss: physics, combat, AI, digivolution.
 * Entities use a bottom-center (x, y) position convention so it lines up
 * with how sprites.js anchors and draws frames.
 */
'use strict';

const GRAVITY = 2100;
const MAX_FALL_SPEED = 980;
const GROUND_FRICTION = 2200;
const AIR_CONTROL = 0.7;

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
    if (moveDir !== 0 && !this.attackState) this.facing = moveDir;

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

    // horizontal movement
    let targetVx = 0;
    if (!this.attackState) {
      targetVx = (this._moveDir || 0) * this.speed;
    }
    const accel = this.grounded ? GROUND_FRICTION : GROUND_FRICTION * AIR_CONTROL;
    if (this.knockbackX !== 0) {
      this.vx = this.knockbackX;
      this.knockbackX *= 0.85;
      if (Math.abs(this.knockbackX) < 10) this.knockbackX = 0;
    } else if (this.vx < targetVx) {
      this.vx = Math.min(targetVx, this.vx + accel * dtS);
    } else if (this.vx > targetVx) {
      this.vx = Math.max(targetVx, this.vx - accel * dtS);
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
    this.vy = Math.min(MAX_FALL_SPEED, this.vy + GRAVITY * dtS);

    if (this.hurtTimer > 0) {
      this.hurtTimer -= dt;
      this.vx *= 0.9;
    } else {
      const dx = player.x - this.x;
      const dist = Math.abs(dx);
      if (this.def.behavior === 'chase' && dist < 380 && Math.abs(player.y - this.y) < 140) {
        this.facing = dx > 0 ? 1 : -1;
        this.vx = this.facing * this.def.speed;
      } else {
        // patrol
        if (this.x > this.spawnX + this.patrolRange) this.patrolDir = -1;
        else if (this.x < this.spawnX - this.patrolRange) this.patrolDir = 1;
        this.facing = this.patrolDir;
        this.vx = this.patrolDir * this.def.speed * 0.6;
      }
      if (this.attackCooldown > 0) this.attackCooldown -= dt;
      if (dist < 46 && Math.abs(player.y - this.y) < 90 && this.attackCooldown <= 0 && !player.isInvulnerable) {
        player.takeDamage(this.def.atk, dx > 0 ? -1 : 1, particles);
        this.attackCooldown = 900;
      }
    }

    moveAndCollide(this, this.vx * dtS, this.vy * dtS, solids);
  }

  draw(ctx, cameraX) {
    if (this.dead && this.deathTimer <= 0) return;
    ctx.save();
    if (this.dead) ctx.globalAlpha = Math.max(0, this.deathTimer / 400);
    if (this.hurtTimer > 0) ctx.filter = 'brightness(2)';
    const x = this.x - cameraX, y = this.y;
    ctx.translate(x, y);
    ctx.scale(this.facing, 1);
    ctx.fillStyle = this.def.color;
    roundRectPath(ctx, -this.width / 2, -this.height, this.width, this.height, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    roundRectPath(ctx, -this.width / 2, -this.height, this.width, this.height * 0.35, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(this.width * 0.15, -this.height * 0.78, 4, 0, Math.PI * 2); ctx.fill();
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
    this.def = { ...def, behavior: 'chase' };
    this.hp = def.hp; this.maxHp = def.hp;
    this.phase = 1;
    this.projectiles = [];
    this.rangedCooldown = 2000;
    this.isBoss = true;
    this.roared = false;
  }

  update(dt, solids, player, particles) {
    if (!this.roared) { this.roared = true; AudioSys.sfx('bossRoar'); }
    if (this.hp / this.maxHp <= 0.5 && this.phase === 1) {
      this.phase = 2;
      this.def = { ...this.def, speed: this.def.speed * 1.3 };
      AudioSys.sfx('bossRoar');
    }
    super.update(dt, solids, player, particles);

    if (this.phase === 2 && !this.dead) {
      this.rangedCooldown -= dt;
      if (this.rangedCooldown <= 0) {
        this.rangedCooldown = 1800;
        const dir = player.x > this.x ? 1 : -1;
        this.projectiles.push({ x: this.x, y: this.y - this.height * 0.6, vx: dir * 260, vy: -60, life: 2200 });
      }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.vy += GRAVITY * 0.3 * dt / 1000;
      p.x += p.vx * dt / 1000;
      p.y += p.vy * dt / 1000;
      p.life -= dt;
      if (p.life <= 0) { this.projectiles.splice(i, 1); continue; }
      if (!player.isInvulnerable) {
        const dx = Math.abs(p.x - player.x), dy = Math.abs(p.y - (player.y - player.height / 2));
        if (dx < 26 && dy < 40) {
          player.takeDamage(this.def.atk * 0.7, p.vx > 0 ? 1 : -1, particles);
          this.projectiles.splice(i, 1);
        }
      }
    }
  }

  draw(ctx, cameraX) {
    super.draw(ctx, cameraX);
    for (const p of this.projectiles) {
      ctx.fillStyle = '#ff5030';
      ctx.beginPath();
      ctx.arc(p.x - cameraX, p.y, 9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
