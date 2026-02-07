/* ============================================
   Enemy Class — Context-Based Steering AI
   ============================================ */

// The game engine sets this before enemies are used.
let _g = null;

function setEnemyGameRef(gameRef) {
  _g = gameRef;
}

// ── Steering Constants ──
const NUM_DIRS = 16;
const DIR_VECTORS = [];
for (let i = 0; i < NUM_DIRS; i++) {
  const a = (i / NUM_DIRS) * Math.PI * 2;
  DIR_VECTORS.push({ x: Math.cos(a), y: Math.sin(a) });
}

// Smooth noise via layered sine waves (replaces simplex for simplicity).
// Gives smooth, organic direction changes unique per entity.
function smoothNoise(t, seed) {
  return Math.sin(t * 0.7 + seed * 1.0) * 0.4
       + Math.sin(t * 1.3 + seed * 2.3) * 0.3
       + Math.sin(t * 0.3 + seed * 0.7) * 0.2
       + Math.sin(t * 2.1 + seed * 3.1) * 0.1;
}

class Enemy {
  constructor(x, y, hp, damage, type) {
    this.x = x;
    this.y = y;
    this.hp = hp;
    this.maxHp = hp;
    this.vx = 0;
    this.vy = 0;
    this.damage = damage;
    this.attackCooldown = 0;
    this.hitFlash = 0;
    this.dead = false;
    this.deathTimer = 0;
    this.type = type;

    // Steering AI state
    this.spawnX = x;
    this.spawnY = y;
    this.noiseOffset = Math.random() * 1000;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1; // CW or CCW circling
    this._distToPlayer = 0; // set by coordinator each frame

    // Attack style
    this.attackStyle = type ? (type.attackStyle || "contact") : "contact";
    this.preferredDist = this.attackStyle === "projectile"
      ? 90 + Math.random() * 40   // 90-130 for ranged
      : 55 + Math.random() * 35;  // 55-90 for melee/dash

    // Sword attack state
    this.swordAngle = 0;
    this.swordSwinging = false;
    this.swordSwingTimer = 0;
    this.swordSwingDir = 1;

    // Dash attack state
    this.dashing = false;
    this.dashTimer = 0;
    this.dashDirX = 0;
    this.dashDirY = 0;
    this._dashHitPlayer = false;

    // Stuck detection (for corner escape)
    this.stuckCounter = 0;
    this.lastX = x;
    this.lastY = y;

    // Debug gizmo data (updated each frame by update())
    this._steerScores = new Float32Array(NUM_DIRS);
    this._steerBest = -1;
  }

  get name() { return this.type ? this.type.name : "Monster"; }
  get bodyColor() { return this.hitFlash > 0 ? "#fff" : (this.type ? this.type.bodyColor : "#c44"); }
  get eyeColor() { return this.type ? this.type.eyeColor : "#fff"; }
  get size() { return this.type ? this.type.size : 10; }
  get shape() { return this.type ? this.type.shape : "circle"; }

  // Returns true if enemy should be removed from the list
  update() {
    if (this.dead) {
      this.deathTimer--;
      return this.deathTimer <= 0;
    }
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.hitFlash > 0) this.hitFlash--;

    // ── Knockback ──
    const kbSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (kbSpeed > 0.1) {
      const nx = this.x + this.vx, ny = this.y + this.vy;
      if (!_g.isSolid(Math.floor(nx / _g.TILE), Math.floor(ny / _g.TILE))) {
        this.x = nx; this.y = ny;
      }
    }
    this.vx *= 0.78;
    this.vy *= 0.78;

    if (this.hitFlash > 0 || kbSpeed > 1.5) return false;

    // ── Dash has its own movement — skip steering ──
    if (this.dashing) {
      // Dash update runs in the attack section below, just need state refs
      const state = _g.state;
      const dx = state.playerX - this.x, dy = state.playerY - this.y;
      const distToPlayer = Math.sqrt(dx * dx + dy * dy);
      const toPx = distToPlayer > 0 ? dx / distToPlayer : 0;
      const toPy = distToPlayer > 0 ? dy / distToPlayer : 0;

      // Update dash (movement, damage, timer)
      this.dashTimer--;
      const dashSpeed = 2.5 + (state.currentDungeon.difficulty - 1) * 0.3;
      const nx = this.x + this.dashDirX * dashSpeed;
      const ny = this.y + this.dashDirY * dashSpeed;

      if (_g.isSolid(Math.floor(nx / _g.TILE), Math.floor(ny / _g.TILE))) {
        this.dashing = false;
        this.dashTimer = 0;
        for (let j = 0; j < 5; j++) {
          _g.particles.push({
            x: this.x, y: this.y,
            vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3,
            life: 10 + Math.random() * 5, maxLife: 15,
            size: 2 + Math.random(), type: "hit",
          });
        }
      } else {
        this.x = nx;
        this.y = ny;
      }

      if (this.dashing && !this._dashHitPlayer) {
        const dxP = state.playerX - this.x, dyP = state.playerY - this.y;
        const distP = Math.sqrt(dxP * dxP + dyP * dyP);
        if (distP < 16) {
          this._dashHitPlayer = true;
          this._applyDamageToPlayer(state);
          if (distP > 0) {
            state.velX += (dxP / distP) * 3.0;
            state.velY += (dyP / distP) * 3.0;
          }
        }
      }

      const trailColor = this.type.dashColor || this.bodyColor;
      _g.particles.push({
        x: this.x + (Math.random() - 0.5) * 6,
        y: this.y + (Math.random() - 0.5) * 6,
        vx: -this.dashDirX * 0.5 + (Math.random() - 0.5) * 0.5,
        vy: -this.dashDirY * 0.5 + (Math.random() - 0.5) * 0.5,
        life: 12 + Math.random() * 8, maxLife: 20,
        size: this.size * 0.5 + Math.random() * 2,
        type: "dash_trail", color: trailColor,
      });

      if (this.type.leavesTrail) {
        _g.particles.push({
          x: this.x, y: this.y, vx: 0, vy: 0,
          life: 40 + Math.random() * 20, maxLife: 60,
          size: 4 + Math.random() * 3, type: "ember",
        });
      }

      if (this.dashTimer <= 0) {
        this.dashing = false;
        this._dashHitPlayer = false;
      }

      // Update sword swing if also active
      if (this.swordSwinging) {
        this.swordSwingTimer--;
        this.swordAngle += this.swordSwingDir * (Math.PI / 15);
        if (this.swordSwingTimer <= 0) this.swordSwinging = false;
      }

      return false;
    }

    // ── Context-Based Steering ──
    const state = _g.state;
    const dx = state.playerX - this.x;
    const dy = state.playerY - this.y;
    const distToPlayer = Math.sqrt(dx * dx + dy * dy);
    const hasToken = _g.attackTokens.has(this);

    // Normalised direction to player
    const toPx = distToPlayer > 0 ? dx / distToPlayer : 0;
    const toPy = distToPlayer > 0 ? dy / distToPlayer : 0;

    // Perpendicular (for strafing / circling)
    const perpX = -toPy * this.strafeDir;
    const perpY = toPx * this.strafeDir;

    const interest = new Float32Array(NUM_DIRS);
    const danger  = new Float32Array(NUM_DIRS);
    const t = performance.now() / 1000;
    const inRange = distToPlayer < 320;

    // Engagement pulse — rhythmic in-and-out
    const engagePulse = 0.5 + 0.5 * Math.sin(t * 0.8 + this.noiseOffset * 0.5);

    // Token holders close in aggressively; others hold at preferred distance
    const idealDist = hasToken
      ? (this.attackStyle === "projectile" ? 100 : 18)
      : this.preferredDist;

    // My angle relative to player (for surround spread)
    const myAngle = Math.atan2(this.y - state.playerY, this.x - state.playerX);

    for (let i = 0; i < NUM_DIRS; i++) {
      const dv = DIR_VECTORS[i];

      if (inRange) {
        const chaseDot = dv.x * toPx + dv.y * toPy;
        const strafeDot = dv.x * perpX + dv.y * perpY;

        if (hasToken) {
          // ── TOKEN HOLDER: aggressive approach ──
          // Strong chase that only fades very close
          const chaseW = Math.max(0, (distToPlayer - 15) / 200);
          interest[i] += Math.max(0, chaseDot) * chaseW * (0.7 + engagePulse * 0.3);

          // Light strafe when close — circling before striking
          const strafeW = 1.0 - Math.min(1, distToPlayer / 80);
          interest[i] += Math.max(0, strafeDot) * strafeW * 0.5;

        } else {
          // ── NO TOKEN: menacing orbit at preferred distance ──
          // Chase only if farther than preferred distance
          if (distToPlayer > idealDist) {
            const chaseW = Math.max(0, (distToPlayer - idealDist) / (320 - idealDist));
            interest[i] += Math.max(0, chaseDot) * chaseW * 0.6;
          }

          // Retreat if closer than preferred distance
          if (distToPlayer < idealDist) {
            const retreatDot = -(dv.x * toPx + dv.y * toPy);
            const retreatW = 1 - (distToPlayer / idealDist);
            interest[i] += Math.max(0, retreatDot) * retreatW * 0.5;
          }

          // Strong strafe — squared shaping for sharper sideways preference
          const strafeW = 1.0 - Math.min(1, Math.abs(distToPlayer - idealDist) / 120);
          const shaped = Math.max(0, strafeDot);
          const fwdBias = Math.max(0, chaseDot * 0.2 + 0.8);
          interest[i] += shaped * shaped * strafeW * 0.9 * fwdBias;
        }

        // ── SURROUND SPREAD ──
        // Enemies at similar angles around the player spread apart along the circumference
        if (distToPlayer > 20) {
          const enemies = _g.enemies;
          for (const other of enemies) {
            if (other === this || other.dead) continue;
            const otherDist = other._distToPlayer;
            if (otherDist > 320) continue;
            const otherAngle = Math.atan2(other.y - state.playerY, other.x - state.playerX);
            let angleDiff = myAngle - otherAngle;
            if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

            if (Math.abs(angleDiff) < 0.9) {
              // Push along tangent to spread around the player
              const sign = angleDiff >= 0 ? 1 : -1;
              const tangX = -(this.y - state.playerY) / distToPlayer * sign;
              const tangY = (this.x - state.playerX) / distToPlayer * sign;
              const spreadDot = dv.x * tangX + dv.y * tangY;
              const spreadW = 1 - Math.abs(angleDiff) / 0.9;
              interest[i] += Math.max(0, spreadDot) * spreadW * 0.45;
            }
          }
        }
      } else {
        // ── WANDER (noise-driven) ──
        const wx = smoothNoise(t * 0.5, this.noiseOffset);
        const wy = smoothNoise(t * 0.5, this.noiseOffset + 500);
        const wLen = Math.sqrt(wx * wx + wy * wy) || 1;
        const wanderDot = dv.x * (wx / wLen) + dv.y * (wy / wLen);
        interest[i] += Math.max(0, wanderDot) * 0.4;

        // ── HOME BIAS ──
        const hx = this.spawnX - this.x;
        const hy = this.spawnY - this.y;
        const homeDist = Math.sqrt(hx * hx + hy * hy);
        if (homeDist > 48) {
          const homeNx = hx / homeDist;
          const homeNy = hy / homeDist;
          const homeDot = dv.x * homeNx + dv.y * homeNy;
          const homeW = Math.min(1, (homeDist - 48) / 96);
          interest[i] += Math.max(0, homeDot) * homeW * 0.6;
        }
      }

      // ── SEPARATION (angular shaping) ──
      const enemies = _g.enemies;
      for (const other of enemies) {
        if (other === this || other.dead) continue;
        const sex = this.x - other.x;
        const sey = this.y - other.y;
        const seDist = Math.sqrt(sex * sex + sey * sey);
        if (seDist < 40 && seDist > 0) {
          const awayNx = sex / seDist;
          const awayNy = sey / seDist;
          const awayDot = dv.x * awayNx + dv.y * awayNy;
          const perpADot = Math.abs(dv.x * (-awayNy) + dv.y * awayNx);
          const sepVal = Math.max(0, awayDot * 0.3 + perpADot * 0.7);
          const sepW = 1 - (seDist / 40);
          interest[i] += sepVal * sepW * 0.55;
        }
      }

      // ── DANGER: wall detection ──
      for (let r = 1; r <= 2; r++) {
        const cx = this.x + dv.x * 10 * r;
        const cy = this.y + dv.y * 10 * r;
        if (_g.isSolid(Math.floor(cx / _g.TILE), Math.floor(cy / _g.TILE))) {
          danger[i] = Math.max(danger[i], r === 1 ? 1.0 : 0.5);
        }
      }

      // ── ESCAPE PRESSURE when stuck in corners ──
      if (this.stuckCounter > 30 && danger[i] < 0.3) {
        interest[i] += 0.3 * Math.min(1, (this.stuckCounter - 30) / 60);
      }
    }

    // ── WALL-SLIDE: redistribute blocked interest to adjacent clear dirs ──
    const redistributed = new Float32Array(NUM_DIRS);
    for (let i = 0; i < NUM_DIRS; i++) redistributed[i] = interest[i];
    for (let i = 0; i < NUM_DIRS; i++) {
      if (danger[i] < 0.5) continue;
      const blocked = interest[i] * danger[i];
      if (blocked < 0.01) continue;
      for (let offset = 1; offset <= 3; offset++) {
        const weight = offset === 1 ? 0.5 : offset === 2 ? 0.3 : 0.15;
        const left  = (i - offset + NUM_DIRS) % NUM_DIRS;
        const right = (i + offset) % NUM_DIRS;
        if (danger[left]  < 0.5) redistributed[left]  += blocked * weight;
        if (danger[right] < 0.5) redistributed[right] += blocked * weight;
      }
    }
    for (let i = 0; i < NUM_DIRS; i++) interest[i] = redistributed[i];

    // ── Pick best direction ──
    let bestI = -1;
    let bestScore = -1;
    const finalScores = new Float32Array(NUM_DIRS);
    for (let i = 0; i < NUM_DIRS; i++) {
      finalScores[i] = interest[i] * (1 - danger[i]);
      if (finalScores[i] > bestScore) {
        bestScore = finalScores[i];
        bestI = i;
      }
    }

    this._steerScores.set(finalScores);
    this._steerBest = bestI;

    // ── Move ──
    if (bestI >= 0 && bestScore > 0.01) {
      const baseSpd = 0.45 + (state.currentDungeon.difficulty - 1) * 0.075;
      // Token holders move at full speed; others slightly slower
      const spdMod = inRange ? (hasToken ? 1.0 : 0.75) : 0.5;
      const mx = this.x + DIR_VECTORS[bestI].x * baseSpd * spdMod;
      const my = this.y + DIR_VECTORS[bestI].y * baseSpd * spdMod;
      if (!_g.isSolid(Math.floor(mx / _g.TILE), Math.floor(my / _g.TILE))) {
        this.x = mx;
        this.y = my;
      }
    }

    // ── Stuck detection ──
    const movedDist = Math.abs(this.x - this.lastX) + Math.abs(this.y - this.lastY);
    if (movedDist < 0.15 && inRange) {
      this.stuckCounter++;
    } else {
      this.stuckCounter = Math.max(0, this.stuckCounter - 2);
    }
    this.lastX = this.x;
    this.lastY = this.y;

    // ── Attack dispatch (only with token) ──
    if (hasToken && this.attackCooldown <= 0) {
      if (this.attackStyle === "sword" && distToPlayer < 28 && !this.swordSwinging) {
        this._startSwordSwing(toPx, toPy);
      } else if (this.attackStyle === "dash" && distToPlayer < 80 && distToPlayer > 20 && !this.dashing) {
        this._startDash(toPx, toPy);
      } else if (this.attackStyle === "projectile" && distToPlayer < 150 && distToPlayer > 30) {
        this._fireProjectile(toPx, toPy, state);
      } else if (this.attackStyle === "contact" && distToPlayer < 18) {
        this._doContactDamage(toPx, toPy, state);
      }
    }

    // ── Update sword swing ──
    if (this.swordSwinging) {
      this.swordSwingTimer--;
      this.swordAngle += this.swordSwingDir * (Math.PI / 15);

      // Damage check at mid-swing (frame 10 of 20)
      if (this.swordSwingTimer === 10) {
        const sLen = this.type.swordLength || 18;
        const tipX = this.x + Math.cos(this.swordAngle) * sLen;
        const tipY = this.y + Math.sin(this.swordAngle) * sLen;
        const dxP = state.playerX - tipX, dyP = state.playerY - tipY;
        if (Math.sqrt(dxP * dxP + dyP * dyP) < 16) {
          this._applyDamageToPlayer(state);
        }
      }
      if (this.swordSwingTimer <= 0) this.swordSwinging = false;
    }

    return false;
  }

  // ── Attack helper methods ──

  _applyDamageToPlayer(state) {
    state.hp -= this.damage;
    _g.spawnFloatingText(state.playerX, state.playerY - 25, `-${this.damage} HP`, "#e94560", 16);
    _g.triggerShake(6);
    _g.damageFlash = 12;
    _g.$("#player-hp").textContent = Math.max(0, state.hp);
    if (state.hp <= 0) _g.fleeDungeon(true);
  }

  _doContactDamage(toPx, toPy, state) {
    this._applyDamageToPlayer(state);
    this.attackCooldown = 60;
    if (Math.sqrt(toPx * toPx + toPy * toPy) > 0) {
      state.velX -= toPx * 2.5;
      state.velY -= toPy * 2.5;
    }
  }

  _startSwordSwing(toPx, toPy) {
    this.swordSwinging = true;
    this.swordSwingTimer = 20;
    this.swordAngle = Math.atan2(toPy, toPx) - Math.PI / 3;
    this.swordSwingDir = Math.random() < 0.5 ? 1 : -1;
    this.attackCooldown = 70;
  }

  _startDash(toPx, toPy) {
    this.dashing = true;
    this.dashTimer = 15;
    this.dashDirX = toPx;
    this.dashDirY = toPy;
    this._dashHitPlayer = false;
    this.attackCooldown = 90;
  }

  _fireProjectile(toPx, toPy, state) {
    const projSpeed = 1.8 + (state.currentDungeon.difficulty - 1) * 0.2;
    const projColor = this.type.projectileColor || "#f80";
    const projSize = this.type.projectileSize || 3;

    _g.enemyProjectiles.push({
      x: this.x + toPx * this.size,
      y: this.y + toPy * this.size,
      vx: toPx * projSpeed,
      vy: toPy * projSpeed,
      damage: this.damage,
      life: 180,
      maxLife: 180,
      color: projColor,
      size: projSize,
    });

    this.attackCooldown = 90;

    // Muzzle flash particles
    for (let j = 0; j < 3; j++) {
      _g.particles.push({
        x: this.x + toPx * this.size,
        y: this.y + toPy * this.size,
        vx: toPx * 1.5 + (Math.random() - 0.5) * 1,
        vy: toPy * 1.5 + (Math.random() - 0.5) * 1,
        life: 8 + Math.random() * 5, maxLife: 13,
        size: 1.5 + Math.random(),
        type: "projectile_flash", color: projColor,
      });
    }
  }

  takeHit() {
    this.hp--;
    this.hitFlash = 8;

    // Knockback away from player
    const state = _g.state;
    const dx = this.x - state.playerX, dy = this.y - state.playerY;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    this.vx += (dx / d) * 5;
    this.vy += (dy / d) * 5;

    // Hit particles
    const particles = _g.particles;
    for (let j = 0; j < 5; j++) {
      particles.push({
        x: this.x + (Math.random() - 0.5) * 8,
        y: this.y + (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5) * 2.5,
        vy: (Math.random() - 0.5) * 2.5,
        life: 15 + Math.random() * 10,
        maxLife: 25,
        size: 2 + Math.random() * 2,
        type: "hit",
      });
    }

    _g.spawnFloatingText(this.x, this.y - 15, "HIT!", "#ff8", 12);
    _g.triggerShake(3);

    if (this.hp <= 0) {
      this.dead = true;
      this.deathTimer = 20;
      _g.spawnFloatingText(this.x, this.y - 25, `${this.name} Defeated!`, "#f5c842", 16);
      _g.triggerShake(6);
      for (let j = 0; j < 8; j++) {
        particles.push({
          x: this.x + (Math.random() - 0.5) * 12,
          y: this.y + (Math.random() - 0.5) * 12,
          vx: (Math.random() - 0.5) * 3,
          vy: (Math.random() - 0.5) * 3,
          life: 20 + Math.random() * 15,
          maxLife: 35,
          size: 2.5 + Math.random() * 3,
          type: "death",
        });
      }
    }
  }

  draw() {
    const ctx = _g.ctx;
    const sx = this.x - _g.camX, sy = this.y - _g.camY;
    if (sx < -30 || sx > _g.canvas.width + 30 || sy < -30 || sy > _g.canvas.height + 30) return;
    if (this.dead) ctx.globalAlpha = this.deathTimer / 20;

    const t = performance.now() / 500;
    const bob = this.dead ? 0 : Math.sin(t + this.x * 0.01) * 1.5;
    const { bodyColor, eyeColor, size: sz, shape } = this;

    ctx.save();
    ctx.translate(sx, sy + bob);

    // Dash stretch effect
    if (this.dashing && !this.dead) {
      const dashAngle = Math.atan2(this.dashDirY, this.dashDirX);
      ctx.rotate(dashAngle);
      ctx.scale(1.4, 0.7);
      ctx.rotate(-dashAngle);
    }

    this._drawBody(ctx, shape, bodyColor, eyeColor, sz, t);

    // Draw sword for melee enemies
    if (this.attackStyle === "sword") this._drawSword(ctx);

    this._drawEyes(ctx, shape, eyeColor, sz);

    ctx.restore();

    this._drawHPBar(ctx, sx, sy, sz, bob);
    this._drawSteeringGizmo(ctx, sx, sy + bob);
    if (this.dead) ctx.globalAlpha = 1;
  }

  _drawSteeringGizmo(ctx, sx, sy) {
    if (this.dead || this._steerBest < 0) return;

    // Find max score for normalising line lengths
    let maxS = 0;
    for (let i = 0; i < NUM_DIRS; i++) {
      if (this._steerScores[i] > maxS) maxS = this._steerScores[i];
    }
    if (maxS < 0.001) return;

    const LINE_MAX = 30; // max gizmo line length in px

    for (let i = 0; i < NUM_DIRS; i++) {
      const score = this._steerScores[i];
      const norm = score / maxS; // 0..1
      const len = norm * LINE_MAX;
      if (len < 0.5) continue; // skip near-zero

      const dv = DIR_VECTORS[i];
      const ex = sx + dv.x * len;
      const ey = sy + dv.y * len;

      if (i === this._steerBest) {
        // Selected direction — lime green, thicker
        ctx.strokeStyle = "#0f0";
        ctx.lineWidth = 2.5;
        ctx.globalAlpha = 0.9;
      } else {
        // Gradient: pastel green (high) → red (low)
        const r = Math.round(220 * (1 - norm) + 80 * norm);
        const g = Math.round(80 * (1 - norm) + 220 * norm);
        const b = Math.round(80);
        ctx.strokeStyle = `rgb(${r},${g},${b})`;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.45 + norm * 0.35;
      }

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }

    ctx.globalAlpha = this.dead ? this.deathTimer / 20 : 1;
    ctx.lineWidth = 1;
  }

  _drawBody(ctx, shape, bodyColor, eyeColor, sz, t) {
    if (shape === "square") {
      ctx.fillStyle = bodyColor;
      ctx.fillRect(-sz, -sz, sz * 2, sz * 2);
      ctx.strokeStyle = this.hitFlash > 0 ? "#ddd" : "rgba(0,0,0,0.3)";
      ctx.lineWidth = 2;
      ctx.strokeRect(-sz, -sz, sz * 2, sz * 2);
      if (this.hitFlash <= 0) {
        ctx.strokeStyle = "rgba(0,0,0,0.15)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-sz + 3, -sz + 5); ctx.lineTo(sz - 3, -sz + 5);
        ctx.moveTo(-sz + 2, sz - 4); ctx.lineTo(sz - 2, sz - 4);
        ctx.stroke();
      }
    } else if (shape === "bat") {
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.arc(0, 0, sz, 0, Math.PI * 2);
      ctx.fill();
      const wingAngle = Math.sin(t * 3 + this.x) * 0.4;
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.moveTo(-sz, -2);
      ctx.quadraticCurveTo(-sz * 2.5, -sz * 1.5 + wingAngle * 8, -sz * 2, 2);
      ctx.quadraticCurveTo(-sz * 1.5, 0, -sz, 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(sz, -2);
      ctx.quadraticCurveTo(sz * 2.5, -sz * 1.5 + wingAngle * 8, sz * 2, 2);
      ctx.quadraticCurveTo(sz * 1.5, 0, sz, 2);
      ctx.fill();
    } else if (shape === "spider") {
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.ellipse(0, 0, sz, sz * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, -sz * 0.6, sz * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = bodyColor;
      ctx.lineWidth = 1.5;
      const legWiggle = Math.sin(t * 4 + this.x) * 3;
      for (let side = -1; side <= 1; side += 2) {
        for (let leg = 0; leg < 3; leg++) {
          ctx.beginPath();
          ctx.moveTo(side * sz * 0.6, -2 + leg * 3);
          ctx.lineTo(side * (sz + 6), -5 + leg * 4 + legWiggle * (leg === 1 ? 1 : -0.5));
          ctx.stroke();
        }
      }
    } else if (shape === "wisp") {
      const pulse = 0.7 + 0.3 * Math.sin(t * 2.5 + this.x * 0.05);
      ctx.globalAlpha = (this.dead ? this.deathTimer / 20 : 1) * 0.25 * pulse;
      ctx.fillStyle = eyeColor;
      ctx.beginPath();
      ctx.arc(0, 0, sz * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = (this.dead ? this.deathTimer / 20 : 1) * 0.5 * pulse;
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.arc(0, 0, sz, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = this.dead ? this.deathTimer / 20 : 1;
      ctx.fillStyle = eyeColor;
      ctx.beginPath();
      ctx.arc(0, 0, sz * 0.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (shape === "skull") {
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.arc(0, -2, sz, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-sz * 0.6, sz * 0.4, sz * 1.2, sz * 0.5);
      if (this.hitFlash <= 0) {
        ctx.fillStyle = "#fff";
        for (let tx = -3; tx <= 3; tx += 2) {
          ctx.fillRect(tx - 0.5, sz * 0.4, 1.5, 2.5);
        }
      }
      ctx.fillStyle = this.hitFlash > 0 ? "#ddd" : "#222";
      ctx.beginPath();
      ctx.arc(-3, -3, 3, 0, Math.PI * 2);
      ctx.arc(3, -3, 3, 0, Math.PI * 2);
      ctx.fill();
      if (this.hitFlash <= 0) {
        ctx.fillStyle = eyeColor;
        ctx.beginPath();
        ctx.arc(-3, -3, 1.5, 0, Math.PI * 2);
        ctx.arc(3, -3, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (shape === "ghost") {
      const waveT = t * 2 + this.x * 0.02;
      ctx.fillStyle = bodyColor;
      ctx.globalAlpha = (this.dead ? this.deathTimer / 20 : 1) * 0.7;
      ctx.beginPath();
      ctx.arc(0, -3, sz, Math.PI, 0);
      ctx.lineTo(sz, sz * 0.6);
      for (let wx = sz; wx >= -sz; wx -= 4) {
        ctx.lineTo(wx, sz * 0.6 + Math.sin(waveT + wx * 0.5) * 3);
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = this.dead ? this.deathTimer / 20 : 1;
      if (this.hitFlash <= 0) {
        ctx.fillStyle = eyeColor;
        ctx.beginPath();
        ctx.arc(-3, -4, 3, 0, Math.PI * 2);
        ctx.arc(4, -4, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#111";
        ctx.beginPath();
        ctx.arc(-3, -3, 1.5, 0, Math.PI * 2);
        ctx.arc(4, -3, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (shape === "imp") {
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.arc(0, 0, sz, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = this.hitFlash > 0 ? "#ddd" : "#881100";
      ctx.beginPath();
      ctx.moveTo(-4, -sz + 1); ctx.lineTo(-6, -sz - 6); ctx.lineTo(-1, -sz + 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(4, -sz + 1); ctx.lineTo(6, -sz - 6); ctx.lineTo(1, -sz + 2);
      ctx.fill();
      if (this.hitFlash <= 0) {
        const flicker = Math.random() * 0.15;
        ctx.globalAlpha = (this.dead ? this.deathTimer / 20 : 1) * (0.2 + flicker);
        ctx.fillStyle = "#ff4400";
        ctx.beginPath();
        ctx.arc(0, 0, sz + 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = this.dead ? this.deathTimer / 20 : 1;
      }
      ctx.strokeStyle = bodyColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sz - 2, 3);
      ctx.quadraticCurveTo(sz + 6, 0, sz + 5, -5 + Math.sin(t * 3) * 2);
      ctx.stroke();
    } else if (shape === "slime") {
      const squish = 1 + Math.sin(t * 2 + this.x * 0.02) * 0.1;
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.ellipse(0, 2, sz * squish, sz * (1 / squish) * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
      if (this.hitFlash <= 0) {
        ctx.fillStyle = "#ff6633";
        ctx.globalAlpha = (this.dead ? this.deathTimer / 20 : 1) * 0.4;
        ctx.beginPath();
        ctx.ellipse(0, -1, sz * 0.6 * squish, sz * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = this.dead ? this.deathTimer / 20 : 1;
      }
      if (this.hitFlash <= 0 && !this.dead) {
        ctx.fillStyle = "#ff8844";
        const bubT = t * 1.5 + this.x;
        ctx.beginPath();
        ctx.arc(-3 + Math.sin(bubT) * 2, -2, 1.5, 0, Math.PI * 2);
        ctx.arc(4, -1 + Math.cos(bubT * 0.7) * 2, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.arc(0, 0, sz, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = this.hitFlash > 0 ? "#ddd" : "rgba(0,0,0,0.3)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  _drawEyes(ctx, shape, eyeColor, sz) {
    if (this.hitFlash > 0 || this.dead) return;
    if (["wisp", "skull", "ghost"].includes(shape)) return;
    const state = _g.state;
    const dx = state.playerX - this.x, dy = state.playerY - this.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const lx = (dx / d) * 1.5, ly = (dy / d) * 1.5;
    ctx.fillStyle = eyeColor;
    ctx.beginPath();
    ctx.arc(-3, -2, 2.5, 0, Math.PI * 2);
    ctx.arc(3, -2, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(-3 + lx, -2 + ly, 1.2, 0, Math.PI * 2);
    ctx.arc(3 + lx, -2 + ly, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawSword(ctx) {
    const sLen = this.type.swordLength || 18;
    const color = this.type.swordColor || "#999";
    const state = _g.state;

    if (this.swordSwinging) {
      ctx.save();
      ctx.rotate(this.swordAngle);
      // Blade
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(4, -2.5);
      ctx.lineTo(sLen, 0);
      ctx.lineTo(4, 2.5);
      ctx.closePath();
      ctx.fill();
      // Edge highlight
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(5, -2);
      ctx.lineTo(sLen - 1, 0);
      ctx.stroke();
      // Handle
      ctx.fillStyle = "#5a3a1a";
      ctx.fillRect(0, -2, 5, 4);
      // Guard
      ctx.fillStyle = "#888";
      ctx.fillRect(4, -4, 2, 8);
      ctx.restore();
    } else {
      // Idle: point toward player
      const dx = state.playerX - this.x, dy = state.playerY - this.y;
      const angle = Math.atan2(dy, dx);
      const sz = this.size;
      ctx.save();
      ctx.rotate(angle);
      ctx.globalAlpha *= 0.65;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(sz * 0.7, -1.5);
      ctx.lineTo(sz * 0.7 + sLen * 0.65, 0);
      ctx.lineTo(sz * 0.7, 1.5);
      ctx.closePath();
      ctx.fill();
      // Handle
      ctx.fillStyle = "#5a3a1a";
      ctx.fillRect(sz * 0.4, -1.5, sz * 0.35, 3);
      ctx.restore();
    }
  }

  _drawHPBar(ctx, sx, sy, sz, bob) {
    if (this.hp >= this.maxHp || this.dead) return;
    const bw = 22, bh = 3, bx2 = sx - bw / 2, by2 = sy - sz - 8 + bob;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(bx2 - 1, by2 - 1, bw + 2, bh + 2);
    ctx.fillStyle = "#333";
    ctx.fillRect(bx2, by2, bw, bh);
    const hpFrac = this.hp / this.maxHp;
    ctx.fillStyle = hpFrac > 0.5 ? "#c44" : "#f44";
    ctx.fillRect(bx2, by2, bw * hpFrac, bh);
  }
}
