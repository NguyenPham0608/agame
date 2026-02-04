/* ============================================
   Enemy Class — Shopkeeper's Quest
   ============================================ */

// The game engine sets this before enemies are used.
// Provides access to: ctx, canvas, camX, camY, state, TILE,
// isSolid, particles, spawnFloatingText, triggerShake,
// damageFlash (getter/setter), fleeDungeon, $
let _g = null;

function setEnemyGameRef(gameRef) {
  _g = gameRef;
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
  }

  get name() { return this.type ? this.type.name : "Monster"; }
  get bodyColor() { return this.hitFlash > 0 ? "#fff" : (this.type ? this.type.bodyColor : "#c44"); }
  get eyeColor() { return this.type ? this.type.eyeColor : "#fff"; }
  get size() { return this.type ? this.type.size : 10; }
  get shape() { return this.type ? this.type.shape : "circle"; }

  // Returns true if enemy should be removed
  update() {
    if (this.dead) {
      this.deathTimer--;
      return this.deathTimer <= 0;
    }
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.hitFlash > 0) this.hitFlash--;

    // Apply knockback
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

    const state = _g.state;
    const dx = state.playerX - this.x, dy = state.playerY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Chase player when in range
    if (dist < 320 && dist > 8) {
      const spd = 0.45 + (state.currentDungeon.difficulty - 1) * 0.075;
      const mx = this.x + (dx / dist) * spd, my = this.y + (dy / dist) * spd;
      if (!_g.isSolid(Math.floor(mx / _g.TILE), Math.floor(my / _g.TILE))) {
        this.x = mx; this.y = my;
      }
    }

    // Attack player on contact
    if (dist < 18 && this.attackCooldown <= 0) {
      state.hp -= this.damage;
      this.attackCooldown = 60;
      _g.spawnFloatingText(state.playerX, state.playerY - 25, `-${this.damage} HP`, "#e94560", 16);
      _g.triggerShake(8);
      _g.damageFlash = 15;
      _g.$("#player-hp").textContent = Math.max(0, state.hp);
      if (dist > 0) {
        state.velX -= (dx / dist) * 2.5;
        state.velY -= (dy / dist) * 2.5;
      }
      if (state.hp <= 0) { _g.fleeDungeon(true); return false; }
    }

    return false;
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

    this._drawBody(ctx, shape, bodyColor, eyeColor, sz, t);
    this._drawEyes(ctx, shape, eyeColor, sz);

    ctx.restore();

    this._drawHPBar(ctx, sx, sy, sz, bob);
    if (this.dead) ctx.globalAlpha = 1;
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
