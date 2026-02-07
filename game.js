/* ============================================
   Shopkeeper's Quest — Game Engine
   ============================================ */

(function () {
  "use strict";

  // ──────── STATE ────────
  const state = {
    gold: 50,
    day: 1,
    reputation: 0,
    inventory: {},
    crafted: {},
    customers: [],
    hp: 10,
    maxHp: 10,
    hasKey: false,
    inDungeon: false,
    currentDungeon: null,
    playerX: 0,
    playerY: 0,
    velX: 0,
    velY: 0,
    lootCollected: [],
    goldCollected: 0,
  };

  // ──────── DUNGEON CONSTANTS ────────
  const TILE = 32;
  const ACCEL = 0.55;
  const FRICTION = 0.82;
  const MAX_SPEED = 3.4;
  const PLAYER_SIZE = 20;
  const CAMERA_LERP = 0.1;
  const WALL_FACE_HEIGHT = 25;       // 2.5D south face height in pixels
  const WALL_FACE_EAST_WIDTH = 0;    // 2.5D east face width in pixels

  let camX = 0, camY = 0;
  const keysDown = new Set();
  let dungeonMap = [];
  let mapRows = 0, mapCols = 0;
  let collectedTiles = new Set();
  let animFrame = null;
  let stepTimer = 0;
  let floorNoise = [];
  let particles = [];

  // ──────── TILE IMAGES (15-tile auto-tiling) ────────
  // Place your tileset images in images/walls/{rock,brick,obsidian,tree}/
  // Named: 1.png through 16.png (matching TILE_PATTERNS)
  // 1=top-left corner, 2=top edge, 3=top-right corner
  // 4=left edge, 5=center(interior), 6=right edge
  // 7=bottom-left corner, 8=bottom edge, 9=bottom-right corner
  // 10-16=special cases (isolated, strips, etc.)
  const WALL_IMAGES = {
    rock: {},
    brick: {},
    obsidian: {},
    tree: {},
  };
  let wallImagesLoaded = false;

  function loadWallImages(callback) {
    const wallStyles = ['rock', 'brick', 'obsidian', 'tree'];
    let totalImages = wallStyles.length * 16; // 16 variants per style
    let loadedCount = 0;
    let failedCount = 0;

    for (const style of wallStyles) {
      for (let variant = 1; variant <= 16; variant++) {
        const img = new Image();
        img.onload = () => {
          WALL_IMAGES[style][variant] = img;
          loadedCount++;
          if (loadedCount + failedCount === totalImages) {
            wallImagesLoaded = loadedCount > 0;
            console.log(`Wall images loaded: ${loadedCount}/${totalImages}`);
            if (callback) callback();
          }
        };
        img.onerror = () => {
          failedCount++;
          if (loadedCount + failedCount === totalImages) {
            wallImagesLoaded = loadedCount > 0;
            console.log(`Wall images loaded: ${loadedCount}/${totalImages} (${failedCount} missing - using procedural fallback)`);
            if (callback) callback();
          }
        };
        img.src = `images/walls/${style}/${variant}.png`;
      }
    }

    // If no images at all, callback immediately
    if (totalImages === 0 && callback) callback();
  }

  function hasWallImage(style, variant) {
    return WALL_IMAGES[style] && WALL_IMAGES[style][variant];
  }

  function drawWallImage(style, variant, sx, sy) {
    if (hasWallImage(style, variant)) {
      // Draw with 1px overlap to prevent gaps when zoomed
      ctx.drawImage(WALL_IMAGES[style][variant], sx, sy, TILE + 1, TILE + 1);
      return true;
    }
    return false;
  }

  // Load wall images on startup (async, fallback to procedural if missing)
  loadWallImages();

  // ──────── SWORD & COMBAT ────────
  let mouseScreenX = 0, mouseScreenY = 0;
  let swordScreenX = 0, swordScreenY = 0;
  let swordAngle = 0;
  let swordSwingDir = 0;
  let swordSwingVel = 0;
  let swordSwingTarget = 0;
  let swingFrames = 70;
  const SWING_DURATION = 40;
  const SWORD_ARM_LENGTH = 15;
  const SWORD_BLADE_LENGTH = 40;
  let direction = Math.PI;
  const swingCoefficient = 1;
  let swordHitEnemies = new Set();
  let swoosh = null; // {cx, cy, outerR, innerR, a1, a2, antiCW, alpha}
  let enemies = [];
  let attackTokens = new Set(); // enemies currently allowed to rush in & attack

  // ──────── VISUAL FEEDBACK SYSTEMS ────────
  let floatingTexts = [];
  let flyingIcons = [];
  let shakeIntensity = 0;
  let shakeOffsetX = 0, shakeOffsetY = 0;
  let damageFlash = 0;
  let lootBagItems = [];
  let lootBagPulse = 0;

  // ──────── COMBAT CAMERA ZOOM ────────
  let zoomLevel = 1.0;
  let zoomTarget = 1.0;
  let combatFocusX = 0, combatFocusY = 0;
  let combatFocusActive = false;

  // Seeded random for deterministic decoration
  function seededRand(seed) {
    let s = seed;
    return function () {
      s = (s * 16807 + 0) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  // ──────── DOM REFS ────────
  const $ = (sel) => document.querySelector(sel);
  const screens = {
    title: $("#title-screen"),
    shop: $("#shop-screen"),
    dungeon: $("#dungeon-screen"),
    trade: $("#trade-screen"),
    craft: $("#craft-screen"),
    editor: $("#editor-screen"),
  };
  const canvas = $("#dungeon-canvas");
  const ctx = canvas.getContext("2d");

  // ──────── SCREEN MANAGEMENT ────────
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
    if (name === "dungeon") resizeCanvas();
  }
  function openModal(id) { document.getElementById(id).classList.add("active"); }
  function closeModal(id) { document.getElementById(id).classList.remove("active"); }

  // ──────── HELPERS ────────
  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function matName(id) { return GAME_DATA.materials[id]?.name || id; }
  function matEmoji(id) { return GAME_DATA.materials[id]?.emoji || "?"; }
  function recipeName(id) { const r = GAME_DATA.recipes.find((r) => r.id === id); return r ? r.name : id; }
  function recipeEmoji(id) { const r = GAME_DATA.recipes.find((r) => r.id === id); return r ? r.emoji : "?"; }

  function addMaterial(id, qty) { state.inventory[id] = (state.inventory[id] || 0) + qty; }

  function hasMaterials(ingredients) {
    for (const [mat, qty] of Object.entries(ingredients)) {
      if (mat === "gold") { if (state.gold < qty) return false; }
      else { if ((state.inventory[mat] || 0) < qty) return false; }
    }
    return true;
  }

  function removeMaterials(ingredients) {
    for (const [mat, qty] of Object.entries(ingredients)) {
      if (mat === "gold") { state.gold -= qty; }
      else { state.inventory[mat] -= qty; if (state.inventory[mat] <= 0) delete state.inventory[mat]; }
    }
  }

  function updateHUD() {
    $("#gold-amount").textContent = state.gold;
    $("#day-count").textContent = state.day;
    $("#rep-count").textContent = state.reputation;
    $("#dg-gold").textContent = state.gold;
  }

  // ──────── SHOP ────────
  function renderCustomers() {
    const area = $("#customer-area");
    if (state.customers.length === 0) {
      area.innerHTML = '<p class="empty-msg">No customers waiting. New ones arrive tomorrow!</p>';
      return;
    }
    area.innerHTML = state.customers.map((c, i) => {
      const recipe = GAME_DATA.recipes.find((r) => r.id === c.wants);
      const have = (state.crafted[c.wants] || 0) > 0;
      return `<div class="customer-card">
          <h4>${c.name}</h4>
          <div class="wants">Wants: ${recipe.emoji} ${recipe.name}</div>
          <div class="reward">Reward: ${c.reward} gold</div>
          <div class="patience">Patience: ${c.patience} day${c.patience !== 1 ? "s" : ""} left</div>
          ${have ? `<button class="btn-sell" onclick="GAME.sellTo(${i})">Sell</button>` : ""}
        </div>`;
    }).join("");
  }

  function sellTo(index) {
    const c = state.customers[index];
    if ((state.crafted[c.wants] || 0) <= 0) return;
    state.crafted[c.wants]--;
    if (state.crafted[c.wants] <= 0) delete state.crafted[c.wants];
    state.gold += c.reward;
    state.reputation += 1;
    state.customers.splice(index, 1);
    updateHUD();
    renderCustomers();
  }

  function spawnCustomers() {
    const [min, max] = GAME_DATA.customersPerDay;
    const count = rand(min, max);
    const pool = GAME_DATA.customerPool;
    for (let i = 0; i < count; i++) state.customers.push({ ...pool[rand(0, pool.length - 1)] });
  }

  function endDay() {
    state.customers = state.customers
      .map((c) => ({ ...c, patience: c.patience - 1 }))
      .filter((c) => { if (c.patience <= 0) { state.reputation = Math.max(0, state.reputation - 1); return false; } return true; });
    state.day++;
    spawnCustomers();
    updateHUD();
    renderCustomers();
  }

  // ──────── INVENTORY / RECIPES MODALS ────────
  function showInventory() {
    const list = $("#inventory-list");
    const mats = Object.entries(state.inventory);
    const crafts = Object.entries(state.crafted);
    if (mats.length === 0 && crafts.length === 0) { list.innerHTML = '<p class="empty-msg">Your inventory is empty.</p>'; }
    else {
      let html = "";
      if (mats.length > 0) {
        html += "<h3 style='margin-bottom:10px;color:var(--text-dim)'>Materials</h3>";
        html += mats.map(([id, qty]) => `<div class="inv-row"><span class="mat-name">${matEmoji(id)} ${matName(id)}</span><span class="mat-qty">x${qty}</span></div>`).join("");
      }
      if (crafts.length > 0) {
        html += "<h3 style='margin:14px 0 10px;color:var(--text-dim)'>Crafted Items</h3>";
        html += crafts.map(([id, qty]) => `<div class="inv-row"><span class="mat-name">${recipeEmoji(id)} ${recipeName(id)}</span><span class="mat-qty">x${qty}</span></div>`).join("");
      }
      list.innerHTML = html;
    }
    openModal("inventory-modal");
  }

  function showRecipes() {
    const list = $("#recipes-list");
    list.innerHTML = GAME_DATA.recipes.map((r) => {
      const parts = Object.entries(r.ingredients).map(([mat, qty]) => `<span>${matEmoji(mat)} ${matName(mat)} x${qty}</span>`).join(" ");
      const can = hasMaterials(r.ingredients);
      return `<div class="recipe-card"><h4>${r.emoji} ${r.name}</h4><div class="ingredients">${parts}</div><div class="${can ? "craftable" : "not-craftable"}">${can ? "✓ Can craft" : "✗ Missing materials"}</div></div>`;
    }).join("");
    openModal("recipes-modal");
  }

  // ──────── DUNGEON SELECT ────────
  function showDungeonSelect() {
    const list = $("#dungeon-select-list");
    list.innerHTML = GAME_DATA.dungeons.map((d) => `<div class="dungeon-option" data-id="${d.id}"><h4>${d.name}</h4><p>${d.description}</p><p style="color:var(--danger);font-size:0.85rem">Difficulty: ${"★".repeat(d.difficulty)}${"☆".repeat(5 - d.difficulty)}</p></div>`).join("");
    list.querySelectorAll(".dungeon-option").forEach((el) => {
      el.addEventListener("click", () => { closeModal("dungeon-select-modal"); enterDungeon(el.dataset.id); });
    });
    openModal("dungeon-select-modal");
  }

  // ──────── CANVAS SIZING ────────
  function resizeCanvas() {
    const container = $("#dungeon-screen");
    const hud = container.querySelector(".hud");
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight - (hud ? hud.offsetHeight : 44);
  }

  // ──────── FLOATING TEXT ────────
  function spawnFloatingText(worldX, worldY, text, color, size) {
    floatingTexts.push({
      x: worldX, y: worldY,
      text, color: color || "#fff",
      size: size || 14,
      vy: -1.2,
      life: 50,
      maxLife: 50,
    });
  }

  function updateFloatingTexts() {
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const ft = floatingTexts[i];
      ft.y += ft.vy;
      ft.vy *= 0.97;
      ft.life--;
      if (ft.life <= 0) floatingTexts.splice(i, 1);
    }
  }

  function drawFloatingTexts() {
    for (const ft of floatingTexts) {
      const sx = ft.x - camX + shakeOffsetX;
      const sy = ft.y - camY + shakeOffsetY;
      if (sx < -100 || sx > canvas.width + 100 || sy < -50 || sy > canvas.height + 50) continue;
      const alpha = Math.min(1, ft.life / (ft.maxLife * 0.3));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = ft.color;
      ctx.font = `bold ${ft.size}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ft.text, sx, sy);
      ctx.globalAlpha = 1;
    }
  }

  // ──────── FLYING ICONS ────────
  function spawnFlyingIcon(worldX, worldY, emoji, color) {
    const sx = worldX - camX;
    const sy = worldY - camY;
    flyingIcons.push({
      x: sx, y: sy,
      targetX: canvas.width - 60,
      targetY: canvas.height - 60,
      emoji, color: color || "#fff",
      life: 40,
      maxLife: 40,
    });
    lootBagPulse = 12;
  }

  function updateFlyingIcons() {
    for (let i = flyingIcons.length - 1; i >= 0; i--) {
      const fi = flyingIcons[i];
      const progress = 1 - (fi.life / fi.maxLife);
      const ease = progress * progress;
      fi.x += (fi.targetX - fi.x) * 0.08;
      fi.y += (fi.targetY - fi.y) * 0.08;
      fi.life--;
      if (fi.life <= 0) {
        lootBagItems.push({ emoji: fi.emoji, color: fi.color });
        lootBagPulse = 15;
        flyingIcons.splice(i, 1);
      }
    }
  }

  function drawFlyingIcons() {
    for (const fi of flyingIcons) {
      const alpha = Math.min(1, fi.life / 10);
      ctx.globalAlpha = alpha;
      ctx.font = "18px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(fi.emoji, fi.x, fi.y);
      // Sparkle trail
      ctx.fillStyle = fi.color;
      for (let j = 0; j < 2; j++) {
        ctx.globalAlpha = alpha * 0.4;
        ctx.beginPath();
        ctx.arc(fi.x + (Math.random() - 0.5) * 12, fi.y + (Math.random() - 0.5) * 12, 1.5 + Math.random(), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  // ──────── LOOT BAG ────────
  function drawLootBag() {
    const bx = canvas.width - 60;
    const by = canvas.height - 60;
    const pulse = lootBagPulse > 0 ? 1 + (lootBagPulse / 15) * 0.25 : 1;
    if (lootBagPulse > 0) lootBagPulse--;

    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(pulse, pulse);

    // Bag body
    ctx.fillStyle = "#8B6914";
    ctx.beginPath();
    ctx.moveTo(-14, -4);
    ctx.quadraticCurveTo(-16, 18, 0, 20);
    ctx.quadraticCurveTo(16, 18, 14, -4);
    ctx.closePath();
    ctx.fill();
    // Bag opening
    ctx.fillStyle = "#6B4914";
    ctx.beginPath();
    ctx.ellipse(0, -4, 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#4B2914";
    ctx.beginPath();
    ctx.ellipse(0, -4, 10, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    // Tie
    ctx.strokeStyle = "#5a3a10";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-6, -8); ctx.lineTo(-2, -12); ctx.lineTo(2, -12); ctx.lineTo(6, -8);
    ctx.stroke();

    // Show item count
    if (lootBagItems.length > 0) {
      ctx.fillStyle = "#f5c842";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(lootBagItems.length, 0, 6);
    }

    ctx.restore();

    // Glow when items arrive
    if (lootBagPulse > 5) {
      ctx.globalAlpha = (lootBagPulse - 5) / 10 * 0.3;
      ctx.fillStyle = "#f5c842";
      ctx.beginPath();
      ctx.arc(bx, by, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // ──────── SCREEN SHAKE ────────
  function triggerShake(intensity) {
    shakeIntensity = Math.max(shakeIntensity, intensity);
  }

  function updateShake() {
    if (shakeIntensity > 0.1) {
      shakeOffsetX = (Math.random() - 0.5) * shakeIntensity * 2;
      shakeOffsetY = (Math.random() - 0.5) * shakeIntensity * 2;
      shakeIntensity *= 0.85;
    } else {
      shakeIntensity = 0;
      shakeOffsetX = 0;
      shakeOffsetY = 0;
    }
  }

  // ──────── DAMAGE VIGNETTE ────────
  function drawDamageFlash() {
    if (damageFlash > 0) {
      const alpha = (damageFlash / 15) * 0.4;
      ctx.fillStyle = `rgba(200,30,30,${alpha})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // Vignette edges
      const grad = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, canvas.width * 0.3,
        canvas.width / 2, canvas.height / 2, canvas.width * 0.7
      );
      grad.addColorStop(0, "rgba(200,30,30,0)");
      grad.addColorStop(1, `rgba(200,30,30,${alpha * 0.6})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      damageFlash--;
    }
  }

  // ──────── SPARKLE PARTICLES ────────
  function spawnSparkles(x, y, color, count) {
    for (let i = 0; i < (count || 6); i++) {
      particles.push({
        x: x + (Math.random() - 0.5) * 12,
        y: y + (Math.random() - 0.5) * 12,
        vx: (Math.random() - 0.5) * 2,
        vy: -Math.random() * 2 - 0.5,
        life: 25 + Math.random() * 15,
        maxLife: 40,
        size: 1.5 + Math.random() * 2,
        type: "sparkle",
        color: color || "#fff",
      });
    }
  }

  // ──────── PARTICLES ────────
  function spawnDust(x, y) {
    for (let i = 0; i < 2; i++) {
      particles.push({
        x: x + (Math.random() - 0.5) * 10,
        y: y + 6 + Math.random() * 4,
        vx: (Math.random() - 0.5) * 0.8,
        vy: -Math.random() * 0.5 - 0.2,
        life: 20 + Math.random() * 15,
        maxLife: 35,
        size: 1.5 + Math.random() * 1.5,
        type: "dust",
      });
    }
  }

  function spawnEmber() {
    particles.push({
      x: camX + Math.random() * canvas.width,
      y: camY + canvas.height + 10,
      vx: (Math.random() - 0.5) * 0.6,
      vy: -Math.random() * 1.2 - 0.4,
      life: 80 + Math.random() * 60,
      maxLife: 140,
      size: 1.5 + Math.random() * 2,
      type: "ember",
    });
  }

  function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      if (p.life <= 0) { particles.splice(i, 1); }
    }
    if (particles.length > 80) particles.splice(0, particles.length - 80);
  }

  function drawParticles() {
    for (const p of particles) {
      const alpha = Math.min(1, p.life / (p.maxLife * 0.3));
      const sx = p.x - camX, sy = p.y - camY;
      if (sx < -10 || sx > canvas.width + 10 || sy < -10 || sy > canvas.height + 10) continue;
      ctx.beginPath();
      ctx.arc(sx, sy, p.size, 0, Math.PI * 2);
      if (p.type === "ember") {
        ctx.fillStyle = `rgba(255,${80 + Math.random() * 40},0,${alpha * 0.8})`;
      } else if (p.type === "hit") {
        ctx.fillStyle = `rgba(255,255,100,${alpha * 0.9})`;
      } else if (p.type === "death") {
        ctx.fillStyle = `rgba(200,60,60,${alpha * 0.7})`;
      } else if (p.type === "sparkle") {
        const c = p.color || "#fff";
        ctx.fillStyle = c;
        ctx.globalAlpha = alpha * 0.9;
        // Diamond sparkle shape
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(performance.now() / 200 + p.x);
        ctx.fillRect(-p.size, -0.5, p.size * 2, 1);
        ctx.fillRect(-0.5, -p.size, 1, p.size * 2);
        ctx.restore();
        ctx.globalAlpha = 1;
        continue;
      } else if (p.type === "heal") {
        ctx.fillStyle = `rgba(100,255,150,${alpha * 0.8})`;
      } else {
        ctx.fillStyle = `rgba(200,190,170,${alpha * 0.4})`;
      }
      ctx.fill();
    }
  }

  // ──────── ENTER DUNGEON ────────
  function enterDungeon(id, customLevel) {
    const dungeon = customLevel || GAME_DATA.dungeons.find((d) => d.id === id);
    if (!dungeon) return;

    state.currentDungeon = dungeon;
    state.hp = dungeon.playerHP;
    state.maxHp = dungeon.playerHP;
    state.hasKey = false;
    state.playerX = dungeon.startPixel[0];
    state.playerY = dungeon.startPixel[1];
    state.velX = 0;
    state.velY = 0;
    state.inDungeon = true;
    state.lootCollected = [];
    state.goldCollected = 0;
    collectedTiles = new Set();
    particles = [];
    floatingTexts = [];
    flyingIcons = [];
    shakeIntensity = 0;
    shakeOffsetX = 0; shakeOffsetY = 0;
    damageFlash = 0;
    lootBagItems = [];
    lootBagPulse = 0;
    swoosh = null;
    attackTokens.clear();

    dungeonMap = dungeon.map.map((row) => [...row]);
    mapRows = dungeonMap.length;
    mapCols = dungeonMap[0].length;

    floorNoise = [];
    for (let r = 0; r < mapRows; r++) {
      floorNoise[r] = [];
      for (let c = 0; c < mapCols; c++) {
        floorNoise[r][c] = seededRand(r * 1000 + c * 7 + 42)();
      }
    }

    // Init combat
    initEnemies();
    swordSwingDir = 0;
    swordSwingVel = 0;
    swordSwingTarget = 0;
    swordAngle = 0;
    direction = Math.PI;
    swingFrames = SWING_DURATION;
    swordHitEnemies = new Set();
    zoomLevel = 1.0;
    zoomTarget = 1.0;
    combatFocusActive = false;

    camX = state.playerX - canvas.width / 2;
    camY = state.playerY - canvas.height / 2;

    $("#dungeon-name").textContent = dungeon.name;
    $("#player-hp").textContent = state.hp;
    $("#player-max-hp").textContent = state.maxHp;

    showScreen("dungeon");

    camX = state.playerX - canvas.width / 2;
    camY = state.playerY - canvas.height / 2;
    clampCamera();

    spawnFloatingText(state.playerX, state.playerY - 30, dungeon.name, "#f5c842", 18);
    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = requestAnimationFrame(gameLoop);
  }

  // ──────── COLLISION ────────
  function isSolid(col, row) {
    if (row < 0 || row >= mapRows || col < 0 || col >= mapCols) return true;
    const t = dungeonMap[row][col];
    return t === 1 || (t === 8 && !state.hasKey);
  }

  function isWall(col, row) {
    if (row < 0 || row >= mapRows || col < 0 || col >= mapCols) return true;
    return dungeonMap[row][col] === 1;
  }

  function tryMove(dx, dy) {
    const hs = PLAYER_SIZE / 2;
    const nx = state.playerX + dx, ny = state.playerY + dy;
    const left = nx - hs, right = nx + hs - 1, top = ny - hs, bottom = ny + hs - 1;
    if (!isSolid(Math.floor(left / TILE), Math.floor(top / TILE)) &&
      !isSolid(Math.floor(right / TILE), Math.floor(top / TILE)) &&
      !isSolid(Math.floor(left / TILE), Math.floor(bottom / TILE)) &&
      !isSolid(Math.floor(right / TILE), Math.floor(bottom / TILE))) {
      state.playerX = nx;
      state.playerY = ny;
      return true;
    }
    return false;
  }

  // ──────── TILE INTERACTION ────────
  function checkTileInteractions() {
    const col = Math.floor(state.playerX / TILE);
    const row = Math.floor(state.playerY / TILE);
    const key = `${row},${col}`;
    if (collectedTiles.has(key)) return;
    const tile = dungeonMap[row]?.[col];
    if (tile === undefined || tile === 0 || tile === 1) return;

    switch (tile) {
      case 2: {
        const loot = state.currentDungeon.loot;
        const mat = loot[rand(0, loot.length - 1)];
        addMaterial(mat, 1);
        state.lootCollected.push(mat);
        collectedTiles.add(key);
        dungeonMap[row][col] = 0;
        spawnFloatingText(state.playerX, state.playerY - 20, `${matEmoji(mat)} ${matName(mat)}`, "#4ecca3", 14);
        spawnFlyingIcon(state.playerX, state.playerY, matEmoji(mat), GAME_DATA.materials[mat]?.color || "#4ecca3");
        spawnSparkles(state.playerX, state.playerY, GAME_DATA.materials[mat]?.color || "#4ecca3", 8);
        break;
      }
      case 3: {
        const dmg = state.currentDungeon.trapDamage;
        state.hp -= dmg;
        collectedTiles.add(key);
        dungeonMap[row][col] = 0;
        spawnFloatingText(state.playerX, state.playerY - 20, `-${dmg} HP`, "#e94560", 16);
        triggerShake(6);
        damageFlash = 12;
        $("#player-hp").textContent = Math.max(0, state.hp);
        if (state.hp <= 0) { fleeDungeon(true); return; }
        break;
      }
      case 5: exitDungeon(); return;
      case 6: {
        const amt = rand(5, 15);
        state.gold += amt;
        state.goldCollected += amt;
        collectedTiles.add(key);
        dungeonMap[row][col] = 0;
        spawnFloatingText(state.playerX, state.playerY - 20, `+${amt} Gold`, "#f5c842", 15);
        spawnFlyingIcon(state.playerX, state.playerY, "$", "#f5c842");
        spawnSparkles(state.playerX, state.playerY, "#f5c842", 6);
        break;
      }
      case 7: {
        const heal = Math.min(4, state.maxHp - state.hp);
        state.hp += heal;
        collectedTiles.add(key);
        dungeonMap[row][col] = 0;
        spawnFloatingText(state.playerX, state.playerY - 20, `+${heal} HP`, "#4ecca3", 15);
        spawnSparkles(state.playerX, state.playerY, "#4ecca3", 8);
        // Heal particles
        for (let i = 0; i < 6; i++) {
          particles.push({
            x: state.playerX + (Math.random() - 0.5) * 16,
            y: state.playerY + (Math.random() - 0.5) * 16,
            vx: (Math.random() - 0.5) * 0.8,
            vy: -Math.random() * 1.5 - 0.5,
            life: 25 + Math.random() * 15,
            maxLife: 40,
            size: 2 + Math.random() * 2,
            type: "heal",
          });
        }
        $("#player-hp").textContent = state.hp;
        break;
      }
      case 8: {
        if (state.hasKey) {
          state.hasKey = false; dungeonMap[row][col] = 0; collectedTiles.add(key);
          spawnFloatingText(state.playerX, state.playerY - 20, "Door Unlocked!", "#f5c842", 14);
          spawnSparkles(state.playerX, state.playerY, "#f5c842", 10);
          triggerShake(3);
        }
        break;
      }
      case 9: {
        state.hasKey = true;
        collectedTiles.add(key);
        dungeonMap[row][col] = 0;
        spawnFloatingText(state.playerX, state.playerY - 20, "Key Found!", "#f5c842", 15);
        spawnFlyingIcon(state.playerX, state.playerY, "🔑", "#f5c842");
        spawnSparkles(state.playerX, state.playerY, "#f5c842", 8);
        break;
      }
    }
    updateHUD();
  }

  // ──────── CAMERA ────────
  function clampCamera() {
    const viewW = canvas.width / zoomLevel;
    const viewH = canvas.height / zoomLevel;
    camX = Math.max(0, Math.min(camX, mapCols * TILE - viewW));
    camY = Math.max(0, Math.min(camY, mapRows * TILE - viewH));
  }

  function updateCombatZoom() {
    // Find nearest alive enemy chasing the player
    let nearestEnemy = null;
    let nearestDist = Infinity;
    for (const e of enemies) {
      if (e.dead) continue;
      const dx = state.playerX - e.x, dy = state.playerY - e.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 320 && dist < nearestDist) {
        nearestDist = dist;
        nearestEnemy = e;
      }
    }

    if (nearestEnemy) {
      combatFocusActive = true;
      // Zoom based on distance: closer = more zoom, max 1.35, start zooming at 160
      const t = 1 - Math.min(1, nearestDist / 320);
      const eased = t * t * (3 - 2 * t); // smoothstep
      zoomTarget = 1.0 + eased * 0.175;
      // Focus point: midpoint between player and enemy, biased toward player (70/30)
      combatFocusX = state.playerX * 0.7 + nearestEnemy.x * 0.3;
      combatFocusY = state.playerY * 0.7 + nearestEnemy.y * 0.3;
    } else {
      combatFocusActive = false;
      zoomTarget = 1.0;
    }

    // Ease zoom with different speeds for zoom-in vs zoom-out
    const zoomSpeed = zoomTarget > zoomLevel ? 0.04 : 0.025;
    zoomLevel += (zoomTarget - zoomLevel) * zoomSpeed;
    if (Math.abs(zoomLevel - zoomTarget) < 0.001) zoomLevel = zoomTarget;
  }

  function updateCamera() {
    const viewW = canvas.width / zoomLevel;
    const viewH = canvas.height / zoomLevel;

    let targetX, targetY;
    if (combatFocusActive) {
      targetX = combatFocusX - viewW / 2;
      targetY = combatFocusY - viewH / 2;
    } else {
      targetX = state.playerX - viewW / 2;
      targetY = state.playerY - viewH / 2;
    }

    camX += (targetX - camX) * CAMERA_LERP;
    camY += (targetY - camY) * CAMERA_LERP;
    clampCamera();
  }

  // ──────── NEIGHBOR HELPER ────────
  function getWallNeighbors(col, row) {
    return {
      n: isWall(col, row - 1),
      s: isWall(col, row + 1),
      e: isWall(col + 1, row),
      w: isWall(col - 1, row),
      ne: isWall(col + 1, row - 1),
      nw: isWall(col - 1, row - 1),
      se: isWall(col + 1, row + 1),
      sw: isWall(col - 1, row + 1),
    };
  }

  // ═══════════════════════════════════════
  //  AUTO-TILING SYSTEM (15-tile)
  // ═══════════════════════════════════════
  // Pattern format: [Top][Right][Bottom][Left] where 0=exposed edge, 1=connected
  const TILE_PATTERNS = {
    '0110': 1,  // Top-left outer corner
    '0111': 2,  // Top edge
    '0011': 3,  // Top-right outer corner
    '1110': 4,  // Left edge
    '1111': 5,  // Center (all sides connected) - INTERIOR
    '1011': 6,  // Right edge
    '1100': 7,  // Bottom-left outer corner
    '1101': 8,  // Bottom edge
    '1001': 9,  // Bottom-right outer corner
    '0010': 10, // Top isolated (only bottom connects)
    '0100': 11, // Only right connects
    '0001': 12, // Only left connects
    '1000': 13, // Bottom isolated (only top connects)
    '0101': 14, // Horizontal strip (left and right connect)
    '1010': 15, // Vertical strip (top and bottom connect)
    '0000': 16, // Fully isolated (single tile)
  };

  function getAutoTilePattern(col, row) {
    const hasTop = isWall(col, row - 1);
    const hasRight = isWall(col + 1, row);
    const hasBottom = isWall(col, row + 1);
    const hasLeft = isWall(col - 1, row);
    const pattern = `${hasTop ? '1' : '0'}${hasRight ? '1' : '0'}${hasBottom ? '1' : '0'}${hasLeft ? '1' : '0'}`;
    return TILE_PATTERNS[pattern] || 5;
  }

  function isInteriorTile(col, row) {
    return getAutoTilePattern(col, row) === 5;
  }

  // ═══════════════════════════════════════
  //  THEMED FLOOR DRAWING
  // ═══════════════════════════════════════

  function drawFloor(col, row, sx, sy, dungeon) {
    const n = floorNoise[row]?.[col] || 0;
    const rng = seededRand(row * 337 + col * 113 + 7);
    const style = dungeon.theme.floorStyle;
    const fc = dungeon.floorColor;

    ctx.fillStyle = fc;
    ctx.fillRect(sx, sy, TILE, TILE);

    if (style === "stone") {
      // Stone floor with pebbles and pickaxe marks
      const t = dungeon.theme;
      if (n > 0.7) {
        ctx.fillStyle = t.pebbleColor;
        ctx.beginPath();
        ctx.arc(sx + rng() * 24 + 4, sy + rng() * 24 + 4, 1.5 + rng(), 0, Math.PI * 2);
        ctx.arc(sx + rng() * 20 + 6, sy + rng() * 20 + 6, 1 + rng(), 0, Math.PI * 2);
        ctx.fill();
      }
      if (n > 0.85) {
        // Pickaxe marks
        ctx.strokeStyle = "rgba(80,70,60,0.3)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        const mx = sx + 8 + rng() * 16, my = sy + 8 + rng() * 16;
        ctx.moveTo(mx - 4, my); ctx.lineTo(mx + 4, my + 3);
        ctx.stroke();
      }
      if (n < 0.15) {
        ctx.fillStyle = t.floorAccent;
        ctx.fillRect(sx + 2, sy + 2, TILE - 4, TILE - 4);
      }
      // Subtle grid cracks
      ctx.strokeStyle = "rgba(0,0,0,0.08)";
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, TILE - 1, TILE - 1);

    } else if (style === "grass") {
      const t = dungeon.theme;
      // Base grass variation
      if (n > 0.5) {
        ctx.fillStyle = t.grassColor;
        ctx.fillRect(sx, sy, TILE, TILE);
      }
      // Grass tufts
      if (n > 0.3) {
        ctx.strokeStyle = t.grassLight;
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 3; i++) {
          const gx = sx + rng() * 28 + 2, gy = sy + rng() * 20 + 10;
          ctx.beginPath();
          ctx.moveTo(gx, gy);
          ctx.lineTo(gx - 2 + rng() * 4, gy - 5 - rng() * 4);
          ctx.stroke();
        }
        ctx.lineWidth = 1;
      }
      // Small flowers
      if (n > 0.88) {
        const fc2 = t.flowerColors[Math.floor(rng() * t.flowerColors.length)];
        ctx.fillStyle = fc2;
        ctx.beginPath();
        ctx.arc(sx + 8 + rng() * 16, sy + 8 + rng() * 16, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      // Fallen leaves
      if (n < 0.12) {
        ctx.fillStyle = t.leafColor;
        ctx.beginPath();
        const lx = sx + rng() * 24 + 4, ly = sy + rng() * 24 + 4;
        ctx.ellipse(lx, ly, 3, 1.5, rng() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }

    } else if (style === "slab") {
      const t = dungeon.theme;
      // Stone slab with mortar lines
      ctx.fillStyle = t.slabColor;
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.strokeStyle = t.slabLine;
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 1, sy + 1, TILE - 2, TILE - 2);
      // Cross mortar
      if ((col + row) % 2 === 0) {
        ctx.beginPath();
        ctx.moveTo(sx, sy + TILE / 2);
        ctx.lineTo(sx + TILE, sy + TILE / 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(sx + TILE / 2, sy);
        ctx.lineTo(sx + TILE / 2, sy + TILE);
        ctx.stroke();
      }
      // Cracks
      if (n > 0.85) {
        ctx.strokeStyle = "rgba(0,0,0,0.2)";
        ctx.beginPath();
        const cx2 = sx + rng() * 20 + 6, cy2 = sy + rng() * 20 + 6;
        ctx.moveTo(cx2, cy2);
        ctx.lineTo(cx2 + rng() * 10 - 5, cy2 + rng() * 10 - 5);
        ctx.lineTo(cx2 + rng() * 8, cy2 + rng() * 8);
        ctx.stroke();
      }
      // Faint rune
      if (n < 0.08) {
        ctx.fillStyle = t.runeColor;
        ctx.font = "12px serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const runes = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ";
        ctx.fillText(runes[Math.floor(rng() * runes.length)], sx + TILE / 2, sy + TILE / 2);
      }

    } else if (style === "scorched") {
      const t = dungeon.theme;
      ctx.fillStyle = t.ashColor;
      ctx.fillRect(sx, sy, TILE, TILE);
      // Scorched cracks
      if (n > 0.4) {
        ctx.strokeStyle = t.scorchLine;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const cx2 = sx + rng() * 20 + 6, cy2 = sy + rng() * 20 + 6;
        ctx.moveTo(cx2, cy2);
        for (let i = 0; i < 3; i++) {
          ctx.lineTo(cx2 + rng() * 16 - 8, cy2 + rng() * 16 - 8);
        }
        ctx.stroke();
      }
      // Lava glow cracks
      if (n > 0.82) {
        ctx.strokeStyle = `rgba(255,68,0,${0.15 + n * 0.1})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const gx = sx + rng() * 24 + 4, gy = sy + rng() * 24 + 4;
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + rng() * 12 - 6, gy + rng() * 12 - 6);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      // Ash patches
      if (n < 0.15) {
        ctx.fillStyle = "rgba(60,40,40,0.4)";
        ctx.beginPath();
        ctx.ellipse(sx + 16, sy + 16, 8 + rng() * 4, 5 + rng() * 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ═══════════════════════════════════════
  //  THEMED WALL DRAWING
  // ═══════════════════════════════════════

  function drawWall(col, row, sx, sy, dungeon, nb) {
    const style = dungeon.theme.wallStyle;
    const pattern = getAutoTilePattern(col, row);

    // Try to draw with tileset image first
    if (drawWallImage(style, pattern, sx, sy)) {
      return; // Image drawn successfully
    }

    // Fallback to procedural drawing
    if (style === "rock") drawWall_rock(col, row, sx, sy, dungeon, nb);
    else if (style === "tree") drawWall_tree(col, row, sx, sy, dungeon, nb);
    else if (style === "brick") drawWall_brick(col, row, sx, sy, dungeon, nb);
    else if (style === "obsidian") drawWall_obsidian(col, row, sx, sy, dungeon, nb);
  }

  function drawWall_rock(col, row, sx, sy, dungeon, nb) {
    const t = dungeon.theme;
    const n = floorNoise[row]?.[col] || 0;
    const rng = seededRand(row * 271 + col * 97);
    const pattern = getAutoTilePattern(col, row);
    const isInterior = pattern === 5;

    // Base rock - seamless for interior tiles
    ctx.fillStyle = t.wallBase;
    ctx.fillRect(sx, sy, TILE, TILE);

    if (isInterior) {
      // Interior: seamless rock texture, subtle variation only
      ctx.fillStyle = t.wallHighlight;
      ctx.fillRect(sx, sy, TILE, TILE);
      // Subtle internal cracks
      if (n > 0.6) {
        ctx.strokeStyle = t.wallShadow;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const crx = sx + 8 + rng() * 16, cry = sy + 8 + rng() * 16;
        ctx.moveTo(crx, cry);
        ctx.lineTo(crx + rng() * 8, cry + rng() * 8);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // Ore veins (sparse)
      if (n > 0.85) {
        ctx.strokeStyle = t.oreVeinColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx + rng() * 20 + 6, sy + rng() * 20 + 6);
        ctx.lineTo(sx + rng() * 20 + 6, sy + rng() * 20 + 6);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    } else {
      // Edge tile: full rocky detail
      ctx.fillStyle = t.wallHighlight;
      ctx.beginPath();
      ctx.moveTo(sx + 2 + rng() * 4, sy + 1 + rng() * 3);
      ctx.lineTo(sx + TILE - 2 - rng() * 4, sy + rng() * 4);
      ctx.lineTo(sx + TILE - 1 - rng() * 3, sy + TILE - 2 - rng() * 4);
      ctx.lineTo(sx + 1 + rng() * 4, sy + TILE - 1 - rng() * 3);
      ctx.closePath();
      ctx.fill();

      // Cracks on edges
      ctx.strokeStyle = t.wallShadow;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const crx = sx + 6 + rng() * 12, cry = sy + 6 + rng() * 12;
      ctx.moveTo(crx, cry);
      ctx.lineTo(crx + rng() * 10 - 3, cry + rng() * 12);
      ctx.lineTo(crx + rng() * 8 - 2, cry + rng() * 10 + 4);
      ctx.stroke();

      // Ore veins
      if (n > 0.75) {
        ctx.strokeStyle = t.oreVeinColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx + rng() * 20 + 6, sy + rng() * 20 + 6);
        ctx.lineTo(sx + rng() * 20 + 6, sy + rng() * 20 + 6);
        ctx.stroke();
        ctx.lineWidth = 1;
      }

      // Top highlight (only if top is exposed)
      if (!nb.n) {
        ctx.fillStyle = "rgba(255,255,255,0.15)";
        ctx.fillRect(sx, sy, TILE, 4);
      }
      // Bottom shadow (only if bottom is exposed)
      if (!nb.s) {
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(sx, sy + TILE - 4, TILE, 4);
      }
      // Left edge
      if (!nb.w) {
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.fillRect(sx, sy, 3, TILE);
      }
      // Right edge
      if (!nb.e) {
        ctx.fillStyle = "rgba(0,0,0,0.15)";
        ctx.fillRect(sx + TILE - 3, sy, 3, TILE);
      }

      // Wooden support beam at bottom edges
      if (!nb.s && n > 0.6) {
        ctx.fillStyle = t.beamColor;
        ctx.fillRect(sx + 14, sy + TILE - 6, 4, 6);
        ctx.fillStyle = "rgba(0,0,0,0.15)";
        ctx.fillRect(sx + 14, sy + TILE - 6, 4, 2);
      }
    }
  }

  function drawWall_tree(col, row, sx, sy, dungeon, nb) {
    const t = dungeon.theme;
    const n = floorNoise[row]?.[col] || 0;
    const rng = seededRand(row * 431 + col * 173);
    const pattern = getAutoTilePattern(col, row);
    const isInterior = pattern === 5;

    // Ground under tree
    ctx.fillStyle = dungeon.floorColor;
    ctx.fillRect(sx, sy, TILE, TILE);

    if (isInterior) {
      // Interior: dense forest canopy - less trunk, more foliage blending
      const cx = sx + TILE / 2;
      const cy = sy + TILE / 2;

      // Solid canopy fill for interior
      ctx.fillStyle = t.canopyColor;
      ctx.fillRect(sx, sy, TILE, TILE);

      // Subtle variation
      ctx.fillStyle = t.canopyDark;
      ctx.beginPath();
      ctx.arc(cx + rng() * 8 - 4, cy + rng() * 8 - 4, 8 + rng() * 6, 0, Math.PI * 2);
      ctx.fill();

      // Light patches
      if (n > 0.5) {
        ctx.fillStyle = t.canopyLight;
        ctx.beginPath();
        ctx.arc(cx - 6 + rng() * 12, cy - 6 + rng() * 12, 4 + rng() * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Edge tiles: individual trees with trunks visible
      // Trunk
      const trunkW = 8 + rng() * 6;
      const trunkX = sx + (TILE - trunkW) / 2 + rng() * 4 - 2;
      ctx.fillStyle = t.trunkColor;
      ctx.fillRect(trunkX, sy + 4, trunkW, TILE - 4);
      // Bark texture
      ctx.fillStyle = t.trunkDark;
      ctx.fillRect(trunkX + 2, sy + 8, 2, TILE - 12);
      ctx.fillRect(trunkX + trunkW - 3, sy + 12, 2, TILE - 16);

      // Canopy
      const cx = sx + TILE / 2 + rng() * 4 - 2;
      const cy = sy + 4 + rng() * 4;
      const cr = 14 + rng() * 6;

      // Shadow on ground
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      ctx.beginPath();
      ctx.ellipse(cx + 2, cy + cr + 4, cr * 0.8, cr * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();

      // Main canopy
      ctx.fillStyle = t.canopyColor;
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, Math.PI * 2);
      ctx.fill();

      // Canopy highlight
      ctx.fillStyle = t.canopyLight;
      ctx.beginPath();
      ctx.arc(cx - 3, cy - 3, cr * 0.6, 0, Math.PI * 2);
      ctx.fill();

      // Canopy dark clusters
      ctx.fillStyle = t.canopyDark;
      ctx.beginPath();
      ctx.arc(cx + 4 + rng() * 4, cy + 3 + rng() * 4, cr * 0.4, 0, Math.PI * 2);
      ctx.fill();

      // Small leaves detail
      if (n > 0.5) {
        ctx.fillStyle = t.canopyLight;
        ctx.beginPath();
        ctx.arc(cx - cr * 0.5, cy + rng() * 6 - 3, 3 + rng() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawWall_brick(col, row, sx, sy, dungeon, nb) {
    const t = dungeon.theme;
    const n = floorNoise[row]?.[col] || 0;
    const rng = seededRand(row * 521 + col * 89);
    const pattern = getAutoTilePattern(col, row);
    const isInterior = pattern === 5;

    // Base
    ctx.fillStyle = t.brickColor;
    ctx.fillRect(sx, sy, TILE, TILE);

    // Brick pattern - seamless across all tiles
    ctx.strokeStyle = t.mortarColor;
    ctx.lineWidth = 1;
    // Horizontal mortar
    for (let by = 0; by < TILE; by += 8) {
      ctx.beginPath();
      ctx.moveTo(sx, sy + by);
      ctx.lineTo(sx + TILE, sy + by);
      ctx.stroke();
    }
    // Vertical mortar (offset every other row based on world position for seamless tiling)
    for (let by = 0; by < TILE; by += 8) {
      const worldRow = row * 4 + Math.floor(by / 8);
      const offset = (worldRow % 2 === 0) ? 0 : TILE / 2;
      ctx.beginPath();
      ctx.moveTo(sx + offset, sy + by);
      ctx.lineTo(sx + offset, sy + by + 8);
      ctx.stroke();
      if (offset > 0) {
        ctx.beginPath();
        ctx.moveTo(sx + TILE, sy + by);
        ctx.lineTo(sx + TILE, sy + by + 8);
        ctx.stroke();
      }
    }

    // Brick color variation
    ctx.fillStyle = t.brickDark;
    if (n > 0.7) ctx.fillRect(sx + 2, sy + 2, 14, 6);
    if (n < 0.3) ctx.fillRect(sx + 16, sy + 10, 14, 6);

    if (isInterior) {
      // Interior: just the seamless brick pattern, minimal decoration
      if (n > 0.95) {
        // Rare skull in interior
        ctx.fillStyle = t.skullColor;
        ctx.beginPath();
        ctx.arc(sx + TILE / 2, sy + TILE / 2, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = t.mortarColor;
        ctx.fillRect(sx + TILE / 2 - 2, sy + TILE / 2 - 1, 1.5, 1.5);
        ctx.fillRect(sx + TILE / 2 + 0.5, sy + TILE / 2 - 1, 1.5, 1.5);
      }
    } else {
      // Edge tiles: moss, crumbling, edge effects
      // Moss patches at top edges
      if (n > 0.85 && !nb.n) {
        ctx.fillStyle = t.mossColor;
        ctx.beginPath();
        ctx.arc(sx + 6 + rng() * 20, sy + 2 + rng() * 6, 3 + rng() * 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Crumbling bottom edge
      if (!nb.s && n > 0.6) {
        ctx.fillStyle = dungeon.floorColor;
        ctx.fillRect(sx + rng() * 12, sy + TILE - 3, 4 + rng() * 6, 3);
      }

      // Skull decoration on edges
      if (n > 0.92) {
        ctx.fillStyle = t.skullColor;
        ctx.beginPath();
        ctx.arc(sx + TILE / 2, sy + TILE / 2, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = t.mortarColor;
        ctx.fillRect(sx + TILE / 2 - 2, sy + TILE / 2 - 1, 1.5, 1.5);
        ctx.fillRect(sx + TILE / 2 + 0.5, sy + TILE / 2 - 1, 1.5, 1.5);
      }

      // Edge highlights/shadows
      if (!nb.n) { ctx.fillStyle = "rgba(255,255,255,0.1)"; ctx.fillRect(sx, sy, TILE, 3); }
      if (!nb.s) { ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.fillRect(sx, sy + TILE - 3, TILE, 3); }
      if (!nb.w) { ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fillRect(sx, sy, 2, TILE); }
      if (!nb.e) { ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.fillRect(sx + TILE - 2, sy, 2, TILE); }
    }
  }

  function drawWall_obsidian(col, row, sx, sy, dungeon, nb) {
    const t = dungeon.theme;
    const n = floorNoise[row]?.[col] || 0;
    const rng = seededRand(row * 613 + col * 211);
    const time = performance.now() / 1500;
    const pattern = getAutoTilePattern(col, row);
    const isInterior = pattern === 5;
    const glowAlpha = 0.3 + 0.2 * Math.sin(time + col * 0.5 + row * 0.3);

    // Base dark rock
    ctx.fillStyle = t.rockColor;
    ctx.fillRect(sx, sy, TILE, TILE);

    if (isInterior) {
      // Interior: seamless obsidian with subtle lava glow
      ctx.fillStyle = t.rockHighlight;
      ctx.fillRect(sx, sy, TILE, TILE);

      // Subtle internal lava cracks
      if (n > 0.4) {
        ctx.strokeStyle = `rgba(255,68,0,${glowAlpha * 0.5})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const cx2 = sx + 8 + rng() * 16, cy2 = sy + 8 + rng() * 16;
        ctx.moveTo(cx2, cy2);
        ctx.lineTo(cx2 + rng() * 10, cy2 + rng() * 10);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    } else {
      // Edge tiles: full jagged detail
      ctx.fillStyle = t.rockHighlight;
      ctx.beginPath();
      ctx.moveTo(sx + rng() * 6, sy + rng() * 4);
      ctx.lineTo(sx + TILE / 2 + rng() * 8 - 4, sy + rng() * 3);
      ctx.lineTo(sx + TILE - rng() * 6, sy + rng() * 6);
      ctx.lineTo(sx + TILE - rng() * 4, sy + TILE - rng() * 5);
      ctx.lineTo(sx + rng() * 4, sy + TILE - rng() * 4);
      ctx.closePath();
      ctx.fill();

      // Glowing lava cracks on edges
      ctx.strokeStyle = `rgba(255,68,0,${glowAlpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const cx2 = sx + 4 + rng() * 20, cy2 = sy + 4 + rng() * 20;
      ctx.moveTo(cx2, cy2);
      ctx.lineTo(cx2 + rng() * 14 - 4, cy2 + rng() * 14 - 2);
      ctx.lineTo(cx2 + rng() * 12 - 2, cy2 + rng() * 12 + 4);
      ctx.stroke();

      if (n > 0.6) {
        ctx.strokeStyle = `rgba(255,102,34,${glowAlpha * 0.7})`;
        ctx.beginPath();
        ctx.moveTo(sx + rng() * 28 + 2, sy + rng() * 28 + 2);
        ctx.lineTo(sx + rng() * 28 + 2, sy + rng() * 28 + 2);
        ctx.stroke();
      }
      ctx.lineWidth = 1;

      // Jagged top edge
      if (!nb.n) {
        ctx.fillStyle = t.rockColor;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        for (let x = 0; x <= TILE; x += 4) {
          ctx.lineTo(sx + x, sy - 2 - rng() * 5);
        }
        ctx.lineTo(sx + TILE, sy);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = `rgba(255,68,0,${glowAlpha * 0.4})`;
        ctx.fillRect(sx, sy, TILE, 4);
      }

      // Bottom lava glow
      if (!nb.s) {
        ctx.fillStyle = `rgba(255,68,0,${glowAlpha * 0.5})`;
        ctx.fillRect(sx, sy + TILE - 4, TILE, 4);
      }
      // Left edge glow
      if (!nb.w) {
        ctx.fillStyle = `rgba(255,68,0,${glowAlpha * 0.25})`;
        ctx.fillRect(sx, sy, 3, TILE);
      }
      // Right edge glow
      if (!nb.e) {
        ctx.fillStyle = `rgba(255,68,0,${glowAlpha * 0.35})`;
        ctx.fillRect(sx + TILE - 3, sy, 3, TILE);
      }
    }
  }

  // ──────── SHADOW PASS ────────
  function drawShadows(startCol, endCol, startRow, endRow, rcamX, rcamY) {
    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        if (!isWall(c, r)) continue;
        const sx = c * TILE - rcamX;
        const sy = r * TILE - rcamY;

        // Shadow below wall face (cast from base of 2.5D face)
        if (r + 1 < mapRows && !isWall(c, r + 1)) {
          const shadowY = sy + TILE + WALL_FACE_HEIGHT;
          const grad = ctx.createLinearGradient(sx, shadowY, sx, shadowY + 12);
          grad.addColorStop(0, "rgba(0,0,0,0.4)");
          grad.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = grad;
          ctx.fillRect(sx, shadowY, TILE, 12);
        }
        // Shadow right of wall face (cast from east face edge)
        if (c + 1 < mapCols && !isWall(c + 1, r)) {
          const shadowX = sx + TILE + WALL_FACE_EAST_WIDTH;
          const grad = ctx.createLinearGradient(shadowX, sy, shadowX + 10, sy);
          grad.addColorStop(0, "rgba(0,0,0,0.25)");
          grad.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = grad;
          ctx.fillRect(shadowX, sy, 10, TILE);
        }
      }
    }
  }

  // ──────── 2.5D WALL FACE EFFECT ────────
  function getWallFaceBaseColor(dungeon) {
    const t = dungeon.theme;
    return t.wallShadow || t.brickDark || t.rockColor || t.trunkDark || t.canopyDark || '#3a2a22';
  }

  function drawWallFaces(startCol, endCol, startRow, endRow, rcamX, rcamY, dungeon) {
    const style = dungeon.theme.wallStyle;
    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        if (!isWall(c, r)) continue;
        const sx = c * TILE - rcamX;
        const sy = r * TILE - rcamY;
        const pattern = getAutoTilePattern(c, r);
        const hasSouth = !isWall(c, r + 1);
        const hasEast = !isWall(c + 1, r);

        if (hasSouth) drawFaceSouth(style, pattern, sx, sy, dungeon);
        if (hasEast) drawFaceEast(style, pattern, sx, sy, dungeon, hasSouth);
        if (hasSouth && hasEast) drawFaceCorner(style, pattern, sx, sy, dungeon);
      }
    }
  }

  function drawFaceSouth(style, pattern, sx, sy, dungeon) {
    const fy = sy + TILE;
    const fh = WALL_FACE_HEIGHT;
    const fw = TILE + 1;

    // Base: wall image squeezed into face, or theme color fallback
    if (hasWallImage(style, pattern)) {
      ctx.drawImage(WALL_IMAGES[style][pattern], sx, fy, fw, fh);
    } else {
      ctx.fillStyle = getWallFaceBaseColor(dungeon);
      ctx.fillRect(sx, fy, fw, fh);
    }

    // Dark tint — south face in shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(sx, fy, fw, fh);

    // Depth gradient: darker toward the ground
    const grad = ctx.createLinearGradient(sx, fy, sx, fy + fh);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
    ctx.fillStyle = grad;
    ctx.fillRect(sx, fy, fw, fh);

    // Highlight at top edge (wall lip catching light)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fillRect(sx, fy, fw, 1);

    // Dark line at bottom (ground junction / ambient occlusion)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(sx, fy + fh - 1, fw, 1);
  }

  function drawFaceEast(style, pattern, sx, sy, dungeon, hasSouth) {
    const fx = sx + TILE;
    const fw = WALL_FACE_EAST_WIDTH;
    // If there's also a south face, extend the east face down to meet it
    const fh = TILE + 1;

    // Base: wall image squeezed horizontally, or theme color
    if (hasWallImage(style, pattern)) {
      ctx.drawImage(WALL_IMAGES[style][pattern], fx, sy, fw, fh);
    } else {
      ctx.fillStyle = getWallFaceBaseColor(dungeon);
      ctx.fillRect(fx, sy, fw, fh);
    }

    // Darker tint — east face in deeper shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(fx, sy, fw, fh);

    // Horizontal gradient: darker toward the right edge
    const grad = ctx.createLinearGradient(fx, sy, fx + fw, sy);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
    ctx.fillStyle = grad;
    ctx.fillRect(fx, sy, fw, fh);

    // Highlight at left edge (wall lip)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(fx, sy, 1, fh);

    // Dark line at right edge
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(fx + fw - 1, sy, 1, fh);
  }

  function drawFaceCorner(style, pattern, sx, sy, dungeon) {
    const fx = sx + TILE;
    const fy = sy + TILE;
    const fw = WALL_FACE_EAST_WIDTH;
    const fh = WALL_FACE_HEIGHT;

    // Base
    if (hasWallImage(style, pattern)) {
      ctx.drawImage(WALL_IMAGES[style][pattern], fx, fy, fw, fh);
    } else {
      ctx.fillStyle = getWallFaceBaseColor(dungeon);
      ctx.fillRect(fx, fy, fw, fh);
    }

    // Darkest tint — corner in deepest shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(fx, fy, fw, fh);
  }

  // ──────── ITEM DRAWING ────────
  function drawItems(col, row, sx, sy, dungeon) {
    const key = `${row},${col}`;
    if (collectedTiles.has(key)) return;
    const tile = dungeonMap[row][col];
    const cx = sx + TILE / 2, cy = sy + TILE / 2;
    switch (tile) {
      case 2: drawMaterialPickup(cx, cy, dungeon); break;
      case 3: drawTrap(sx, sy); break;
      case 4: drawEnemy(cx, cy); break;
      case 5: drawExit(sx, sy); break;
      case 6: drawCoin(cx, cy); break;
      case 7: drawPotion(cx, cy); break;
      case 8: drawLockedDoor(sx, sy); break;
      case 9: drawKey(cx, cy); break;
    }
  }

  function drawMaterialPickup(cx, cy, dungeon) {
    const t = performance.now() / 1000;
    const pulse = 0.6 + 0.4 * Math.sin(t * 3 + cx * 0.1);
    const lootColors = dungeon.loot.map(id => GAME_DATA.materials[id]?.color || "#fff");
    const color = lootColors[Math.floor((cx + cy) / TILE) % lootColors.length];
    // Glow
    ctx.globalAlpha = 0.2 * pulse;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.fill();
    // Core
    ctx.globalAlpha = pulse;
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
    // Sparkle
    ctx.fillStyle = "#fff";
    ctx.globalAlpha = pulse * 0.7;
    ctx.beginPath();
    ctx.arc(cx - 2, cy - 2, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawTrap(sx, sy) {
    ctx.strokeStyle = "rgba(200,100,80,0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx + 8, sy + 8); ctx.lineTo(sx + 24, sy + 24);
    ctx.moveTo(sx + 24, sy + 8); ctx.lineTo(sx + 8, sy + 24);
    ctx.moveTo(sx + 16, sy + 6); ctx.lineTo(sx + 16, sy + 26);
    ctx.stroke();
  }

  function drawEnemy(cx, cy) {
    const t = performance.now() / 500;
    const bob = Math.sin(t) * 1.5;
    ctx.beginPath(); ctx.arc(cx, cy + bob, 10, 0, Math.PI * 2);
    ctx.fillStyle = "#c44"; ctx.fill();
    ctx.strokeStyle = "#822"; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(cx - 3, cy - 2 + bob, 3, 0, Math.PI * 2); ctx.arc(cx + 3, cy - 2 + bob, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#111";
    ctx.beginPath(); ctx.arc(cx - 3, cy - 2 + bob, 1.5, 0, Math.PI * 2); ctx.arc(cx + 3, cy - 2 + bob, 1.5, 0, Math.PI * 2); ctx.fill();
  }

  function drawExit(sx, sy) {
    const t = performance.now() / 800;
    const glow = 0.5 + 0.5 * Math.sin(t);
    ctx.fillStyle = `rgba(245,200,66,${0.12 + 0.08 * glow})`;
    ctx.fillRect(sx, sy, TILE, TILE);
    ctx.strokeStyle = `rgba(245,200,66,${0.6 + 0.4 * glow})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx + TILE / 2, sy + TILE / 2, 12, Math.PI, 0);
    ctx.lineTo(sx + TILE / 2 + 12, sy + TILE - 4);
    ctx.lineTo(sx + TILE / 2 - 12, sy + TILE - 4);
    ctx.closePath(); ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = `rgba(245,200,66,${0.8 + 0.2 * glow})`;
    ctx.beginPath();
    ctx.moveTo(sx + TILE / 2, sy + 8);
    ctx.lineTo(sx + TILE / 2 + 5, sy + 16);
    ctx.lineTo(sx + TILE / 2 - 5, sy + 16);
    ctx.fill();
  }

  function drawCoin(cx, cy) {
    const t = performance.now() / 600;
    const bounce = Math.sin(t + cx * 0.1) * 2;
    ctx.beginPath(); ctx.arc(cx, cy + bounce, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#f5c842"; ctx.fill();
    ctx.strokeStyle = "#c8a030"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = "#c8a030"; ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("$", cx, cy + bounce + 0.5);
  }

  function drawPotion(cx, cy) {
    ctx.fillStyle = "#e44";
    ctx.beginPath(); ctx.moveTo(cx - 5, cy - 4); ctx.lineTo(cx + 5, cy - 4); ctx.lineTo(cx + 6, cy + 6); ctx.lineTo(cx - 6, cy + 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#c33"; ctx.fillRect(cx - 3, cy - 8, 6, 5);
    ctx.fillStyle = "#a86"; ctx.fillRect(cx - 3, cy - 10, 6, 3);
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.fillRect(cx - 3, cy - 2, 2, 4);
  }

  function drawLockedDoor(sx, sy) {
    ctx.fillStyle = "#6a5a3a"; ctx.fillRect(sx + 4, sy + 2, TILE - 8, TILE - 4);
    ctx.fillStyle = "#8a7a5a"; ctx.fillRect(sx + 6, sy + 4, TILE - 12, TILE - 8);
    ctx.fillStyle = "#444"; ctx.beginPath(); ctx.arc(sx + TILE / 2, sy + TILE / 2 - 2, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(sx + TILE / 2 - 3, sy + TILE / 2 + 1, 6, 6);
  }

  function drawKey(cx, cy) {
    const t = performance.now() / 700;
    const bounce = Math.sin(t) * 2;
    ctx.fillStyle = "#f5c842"; ctx.beginPath(); ctx.arc(cx, cy - 4 + bounce, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(cx - 1.5, cy + bounce, 3, 10);
    ctx.fillRect(cx - 1.5, cy + 7 + bounce, 5, 3);
    ctx.fillStyle = "#c8a030"; ctx.beginPath(); ctx.arc(cx, cy - 4 + bounce, 3, 0, Math.PI * 2); ctx.fill();
  }

  // ──────── PLAYER DRAWING ────────
  function drawPlayer(screenX, screenY) {
    const speed = Math.sqrt(state.velX * state.velX + state.velY * state.velY);
    const bob = speed > 0.3 ? Math.sin(stepTimer * 0.18) * (1.5 + speed * 0.4) : 0;
    const lean = state.velX * 0.8; // lean into movement
    const facingLeft = direction === Math.PI;

    ctx.save();
    ctx.translate(screenX, screenY);

    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(0, 10, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Slight lean
    ctx.rotate(lean * 0.02);

    // Body
    ctx.fillStyle = "#4466aa";
    ctx.beginPath();
    ctx.arc(0, 2 + bob, 9, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.fillStyle = "#eebb88";
    ctx.beginPath();
    ctx.arc(0, -8 + bob, 6, 0, Math.PI * 2);
    ctx.fill();

    // Hat
    ctx.fillStyle = "#6644aa";
    ctx.beginPath();
    ctx.moveTo(0, -22 + bob);
    ctx.lineTo(-7, -10 + bob);
    ctx.lineTo(7, -10 + bob);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#5533aa";
    ctx.fillRect(-8, -11 + bob, 16, 3);

    // Eyes — face left or right based on sword direction
    ctx.fillStyle = "#222";
    if (facingLeft) {
      ctx.fillRect(-4, -9 + bob, 2, 2);
      ctx.fillRect(-1, -9 + bob, 2, 2);
    } else {
      ctx.fillRect(-1, -9 + bob, 2, 2);
      ctx.fillRect(2, -9 + bob, 2, 2);
    }

    ctx.restore();
  }

  // ──────── FLOATING HAND ────────
  function drawArm() {
    // Floating hand at sword grip
    ctx.fillStyle = "#eebb88";
    ctx.beginPath();
    ctx.arc(swordScreenX, swordScreenY, 3.5, 0, Math.PI * 2);
    ctx.fill();
    // Subtle outline
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // ──────── MINIMAP ────────
  function drawMinimap() {
    const scale = 3;
    const mw = mapCols * scale, mh = mapRows * scale;
    const mx = canvas.width - mw - 10, my = 10;

    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(mx - 2, my - 2, mw + 4, mh + 4);

    for (let r = 0; r < mapRows; r++) {
      for (let c = 0; c < mapCols; c++) {
        const t = dungeonMap[r][c];
        if (t === 1) ctx.fillStyle = "rgba(255,255,255,0.3)";
        else if (t === 5) ctx.fillStyle = "#f5c842";
        else if (t === 2) ctx.fillStyle = "rgba(100,200,255,0.4)";
        else continue;
        ctx.fillRect(mx + c * scale, my + r * scale, scale, scale);
      }
    }

    ctx.fillStyle = "#4f4";
    ctx.fillRect(mx + (state.playerX / TILE) * scale - 2, my + (state.playerY / TILE) * scale - 2, 4, 4);

    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1;
    ctx.strokeRect(mx + (camX / TILE) * scale, my + (camY / TILE) * scale, (canvas.width / TILE) * scale, (canvas.height / TILE) * scale);
  }

  // ──────── HP BAR ────────
  function drawHPBar() {
    const barW = 120, barH = 10, bx = 10, by = canvas.height - 20;
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
    ctx.fillStyle = "#333"; ctx.fillRect(bx, by, barW, barH);
    const frac = Math.max(0, state.hp / state.maxHp);
    ctx.fillStyle = frac > 0.5 ? "#4c4" : frac > 0.25 ? "#ca4" : "#c44";
    ctx.fillRect(bx, by, barW * frac, barH);
    ctx.fillStyle = "#fff"; ctx.font = "9px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(`HP ${state.hp}/${state.maxHp}`, bx + 4, by + barH / 2 + 1);
  }

  // ══════════════════════════════════════
  //  SWORD COMBAT & ENEMY SYSTEM
  // ══════════════════════════════════════

  function initEnemies() {
    enemies = [];
    const types = state.currentDungeon.enemyTypes || [];
    for (let r = 0; r < mapRows; r++) {
      for (let c = 0; c < mapCols; c++) {
        if (dungeonMap[r][c] === 4) {
          const etype = types.length > 0 ? types[Math.floor(Math.random() * types.length)] : null;
          enemies.push(new Enemy(
            c * TILE + TILE / 2,
            r * TILE + TILE / 2,
            state.currentDungeon.enemyHP || 2,
            state.currentDungeon.enemyDamage,
            etype,
          ));
          dungeonMap[r][c] = 0;
        }
      }
    }
  }

  // Exact sword update from sword project — direction sensing, faces away from mouse
  function updateSword() {
    const playerSX = Math.round(state.playerX - camX);
    const playerSY = Math.round(state.playerY - camY);

    // Direction sensing — same as sword project mousemove
    if (mouseScreenX < playerSX) {
      direction = Math.PI;
    } else {
      direction = -Math.PI;
    }

    swordScreenX = playerSX;
    swordScreenY = playerSY;

    if (swingFrames !== SWING_DURATION) {
      swingFrames++;
    } else {
      swordSwingTarget = direction;
    }

    swordScreenY -= 0;
    swordAngle = Math.atan2(mouseScreenY - swordScreenY, mouseScreenX - swordScreenX) + Math.PI / 2;
    swordScreenX += Math.cos(swordAngle) * SWORD_ARM_LENGTH * Math.sign(direction);
    swordScreenY += Math.sin(swordAngle) * SWORD_ARM_LENGTH * Math.sign(direction);
    swordAngle -= Math.PI / 2;

    swordSwingVel += 0.02 * (swordSwingTarget - swordSwingDir);
    swordSwingVel *= 0.85;
    swordSwingDir += swordSwingVel;

    swordAngle += swordSwingDir * 0.8;
    swordScreenX += Math.cos(swordAngle) * SWORD_ARM_LENGTH;
    swordScreenY += Math.sin(swordAngle) * SWORD_ARM_LENGTH;
    swordAngle += swordSwingDir * 0.4;

    // Swoosh arc
    if (swingFrames < SWING_DURATION && Math.abs(swordSwingVel) > 0.06) {
      const sweep = Math.min(Math.abs(swordSwingVel) * 4.5, 2.0);
      const dir = swordSwingVel > 0 ? 1 : -1;
      swoosh = {
        cx: swordScreenX,
        cy: swordScreenY,
        outerR: SWORD_BLADE_LENGTH + 10,
        innerR: SWORD_BLADE_LENGTH * 0.25,
        a1: swordAngle - dir * sweep,
        a2: swordAngle,
        antiCW: dir < 0,
        alpha: 0.6,
      };
    } else if (swoosh) {
      swoosh.alpha -= 0.17;
      if (swoosh.alpha <= 0) swoosh = null;
    }
  }

  // Exact swing from sword project — direction-aware targeting
  function swingSword() {
    swordSwingDir += swingCoefficient * 0.1;
    swingFrames = 0;
    swordSwingTarget = -0.8 * swingCoefficient * direction;
    swordHitEnemies = new Set();
  }

  function pointToSegDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const projX = ax + t * dx, projY = ay + t * dy;
    return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
  }

  function checkSwordHits() {
    if (swingFrames >= SWING_DURATION) return;
    if (Math.abs(swordSwingVel) < 0.03) return;
    const tipSX = swordScreenX + Math.cos(swordAngle) * SWORD_BLADE_LENGTH;
    const tipSY = swordScreenY + Math.sin(swordAngle) * SWORD_BLADE_LENGTH;
    const tipWorldX = tipSX + camX;
    const tipWorldY = tipSY + camY;
    const baseWorldX = swordScreenX + camX;
    const baseWorldY = swordScreenY + camY;
    for (const e of enemies) {
      if (e.dead || swordHitEnemies.has(e)) continue;
      const dist = pointToSegDist(e.x, e.y, baseWorldX, baseWorldY, tipWorldX, tipWorldY);
      if (dist < 14) {
        swordHitEnemies.add(e);
        e.takeHit();
      }
    }
  }

  function updateEnemyCoordination() {
    // Assign attack tokens to the N closest in-range enemies
    const maxTokens = Math.min(2, Math.ceil(state.currentDungeon.difficulty));
    const alive = [];
    for (const e of enemies) {
      if (e.dead) continue;
      const dx = e.x - state.playerX, dy = e.y - state.playerY;
      e._distToPlayer = Math.sqrt(dx * dx + dy * dy);
      if (e._distToPlayer < 320) alive.push(e);
    }
    alive.sort((a, b) => a._distToPlayer - b._distToPlayer);
    attackTokens.clear();
    for (let i = 0; i < Math.min(maxTokens, alive.length); i++) {
      attackTokens.add(alive[i]);
    }
  }

  function updateEnemies() {
    updateEnemyCoordination();
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (enemies[i].update()) enemies.splice(i, 1);
      if (!state.inDungeon) return;
    }
  }

  // Sword drawn at its computed screen position — matches sword project rendering
  function drawSword() {
    ctx.save();
    ctx.translate(swordScreenX, swordScreenY);
    ctx.rotate(swordAngle);
    // Pommel
    ctx.fillStyle = "#555";
    ctx.beginPath();
    ctx.arc(3, -1, 2.5, 0, Math.PI * 2);
    ctx.fill();
    // Handle
    ctx.fillStyle = "#7a5a30";
    ctx.fillRect(0, -2, 10, 4);
    // Cross-guard
    ctx.fillStyle = "#aaa";
    ctx.fillRect(9, -5, 3, 10);
    // Blade — extends along +X in local space
    ctx.fillStyle = "#ccd";
    ctx.beginPath();
    ctx.moveTo(12, -3);
    ctx.lineTo(SWORD_BLADE_LENGTH + 10, 0);
    ctx.lineTo(12, 3);
    ctx.closePath();
    ctx.fill();
    // Blade highlight
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.moveTo(14, -1);
    ctx.lineTo(SWORD_BLADE_LENGTH + 8, 0);
    ctx.lineTo(14, 1);
    ctx.closePath();
    ctx.fill();
    // Blade outline
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(12, -3);
    ctx.lineTo(SWORD_BLADE_LENGTH + 10, 0);
    ctx.lineTo(12, 3);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    // Swoosh crescent
    if (swoosh && swoosh.alpha > 0) {
      ctx.globalAlpha = swoosh.alpha;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(swoosh.cx, swoosh.cy, swoosh.outerR, swoosh.a1, swoosh.a2, swoosh.antiCW);
      ctx.arc(swoosh.cx, swoosh.cy, swoosh.innerR, swoosh.a2, swoosh.a1, !swoosh.antiCW);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // ══════════════════════════════════════
  //  GAME LOOP
  // ══════════════════════════════════════

  function gameLoop() {
    if (!state.inDungeon) return;

    // ── Input → acceleration ──
    let inputX = 0, inputY = 0;
    if (keysDown.has("w") || keysDown.has("arrowup")) inputY = -1;
    if (keysDown.has("s") || keysDown.has("arrowdown")) inputY = 1;
    if (keysDown.has("a") || keysDown.has("arrowleft")) inputX = -1;
    if (keysDown.has("d") || keysDown.has("arrowright")) inputX = 1;

    // Normalize diagonal input
    if (inputX !== 0 && inputY !== 0) {
      const f = 1 / Math.SQRT2;
      inputX *= f;
      inputY *= f;
    }

    // Apply acceleration
    state.velX += inputX * ACCEL;
    state.velY += inputY * ACCEL;

    // Clamp to max speed
    const speed = Math.sqrt(state.velX * state.velX + state.velY * state.velY);
    if (speed > MAX_SPEED) {
      state.velX = (state.velX / speed) * MAX_SPEED;
      state.velY = (state.velY / speed) * MAX_SPEED;
    }

    // Apply friction
    state.velX *= FRICTION;
    state.velY *= FRICTION;

    // Dead zone — snap to zero
    if (Math.abs(state.velX) < 0.08) state.velX = 0;
    if (Math.abs(state.velY) < 0.08) state.velY = 0;

    // ── Movement with wall-sliding ──
    const dx = state.velX, dy = state.velY;
    let moved = false;
    if (dx !== 0 || dy !== 0) {
      if (tryMove(dx, dy)) {
        moved = true;
      } else {
        if (dx !== 0 && tryMove(dx, 0)) { moved = true; state.velY *= 0.3; }
        if (dy !== 0 && tryMove(0, dy)) { moved = true; state.velX *= 0.3; }
        if (!moved) { state.velX *= 0.2; state.velY *= 0.2; }
      }

    }

    const curSpeed = Math.sqrt(state.velX * state.velX + state.velY * state.velY);
    if (curSpeed > 0.3) stepTimer++;

    // Dust particles when moving
    if (curSpeed > 1.0 && stepTimer % 4 === 0) {
      spawnDust(state.playerX, state.playerY);
    }

    // Ambient embers for volcano
    if (state.currentDungeon.theme.wallStyle === "obsidian" && Math.random() < 0.08) {
      spawnEmber();
    }

    // Sword & combat
    updateSword();
    updateEnemies();
    if (!state.inDungeon) return;
    checkSwordHits();

    // Tile interactions
    checkTileInteractions();
    if (!state.inDungeon) return;

    // Camera & combat zoom
    updateCombatZoom();
    updateCamera();

    // Update systems
    updateParticles();
    updateFloatingTexts();
    updateFlyingIcons();
    updateShake();

    // ── DRAW ──
    const dungeon = state.currentDungeon;
    ctx.fillStyle = dungeon.ambientColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Apply zoom + screen shake to world rendering
    ctx.save();
    // Disable image smoothing for crisp pixels when zoomed
    ctx.imageSmoothingEnabled = false;
    // Zoom from center of canvas
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(zoomLevel, zoomLevel);
    ctx.translate(-canvas.width / 2, -canvas.height / 2);
    ctx.translate(shakeOffsetX, shakeOffsetY);

    const viewW = canvas.width / zoomLevel;
    const viewH = canvas.height / zoomLevel;
    // Round camera once to prevent sub-pixel gaps between tiles
    const rcamX = Math.floor(camX);
    const rcamY = Math.floor(camY);
    const startCol = Math.max(0, Math.floor(rcamX / TILE) - 1);
    const endCol = Math.min(mapCols - 1, Math.floor((rcamX + viewW) / TILE) + 2);
    const startRow = Math.max(0, Math.floor(rcamY / TILE) - 1);
    const endRow = Math.min(mapRows - 1, Math.floor((rcamY + viewH) / TILE) + 2);

    // Pass 1: Floors
    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        if (dungeonMap[r][c] === 1) continue;
        drawFloor(c, r, c * TILE - rcamX, r * TILE - rcamY, dungeon);
      }
    }

    // Pass 2: Wall Faces (2.5D depth effect — south/east sides of walls)
    drawWallFaces(startCol, endCol, startRow, endRow, rcamX, rcamY, dungeon);

    // Pass 3: Shadows (cast from base of wall faces)
    drawShadows(startCol, endCol, startRow, endRow, rcamX, rcamY);

    // Pass 4: Items on floor (drawn after faces so items appear in front)
    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        if (dungeonMap[r][c] === 1) continue;
        drawItems(c, r, c * TILE - rcamX, r * TILE - rcamY, dungeon);
      }
    }

    // Pass 5: Wall Tops (the top surface of walls, drawn last for depth)
    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        if (dungeonMap[r][c] !== 1) continue;
        const nb = getWallNeighbors(c, r);
        drawWall(c, r, c * TILE - rcamX, r * TILE - rcamY, dungeon, nb);
      }
    }

    // Pass 6: Particles
    drawParticles();

    // Pass 7: Enemies
    for (const e of enemies) e.draw();

    // Pass 8: Player, Arm & Sword
    drawPlayer(Math.round(state.playerX - rcamX), Math.round(state.playerY - rcamY));
    drawArm();
    drawSword();

    // Pass 9: Floating text (world-space)
    drawFloatingTexts();

    ctx.restore(); // End screen shake offset

    // Pass 10: UI overlays (not affected by shake)
    drawMinimap();
    drawHPBar();
    drawLootBag();
    drawFlyingIcons();
    drawDamageFlash();

    animFrame = requestAnimationFrame(gameLoop);
  }

  // ──────── EXIT / FLEE ────────
  function showDungeonResult(type, title, bodyHTML) {
    const overlay = $("#dungeon-result");
    const titleEl = $("#result-title");
    const bodyEl = $("#result-body");
    titleEl.textContent = title;
    titleEl.className = type === "cleared" ? "result-cleared" : type === "defeated" ? "result-defeated" : "result-fled";
    bodyEl.innerHTML = bodyHTML;
    overlay.classList.add("active");
  }

  function exitDungeon() {
    state.inDungeon = false;
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }

    let bodyHTML = "";
    if (state.lootCollected.length > 0) {
      bodyHTML += "<div>Materials found:</div>";
      const counts = {};
      state.lootCollected.forEach(m => { counts[m] = (counts[m] || 0) + 1; });
      bodyHTML += Object.entries(counts).map(([m, q]) =>
        `<span class="loot-item">${matEmoji(m)} ${matName(m)} x${q}</span>`
      ).join(" ");
    } else {
      bodyHTML += "<div>No materials found.</div>";
    }
    if (state.goldCollected > 0) {
      bodyHTML += `<div style="margin-top:8px"><span class="loot-gold">+${state.goldCollected} Gold</span></div>`;
    }

    showDungeonResult("cleared", "Dungeon Cleared!", bodyHTML);
  }

  function fleeDungeon(defeated) {
    state.inDungeon = false;
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }

    let bodyHTML = "";
    if (defeated) {
      const lost = Math.floor(state.lootCollected.length / 2);
      const lostItems = [];
      for (let i = 0; i < lost; i++) {
        const mat = state.lootCollected.pop();
        lostItems.push(mat);
        if (state.inventory[mat]) { state.inventory[mat]--; if (state.inventory[mat] <= 0) delete state.inventory[mat]; }
      }
      bodyHTML += "<div>You were defeated and lost some materials.</div>";
      if (lostItems.length > 0) {
        bodyHTML += "<div style='margin-top:6px;color:var(--danger)'>Lost: ";
        bodyHTML += lostItems.map(m => `<span class="loot-item">${matEmoji(m)} ${matName(m)}</span>`).join(" ");
        bodyHTML += "</div>";
      }
      if (state.lootCollected.length > 0) {
        bodyHTML += "<div style='margin-top:6px'>Kept: ";
        bodyHTML += state.lootCollected.map(m => `<span class="loot-item">${matEmoji(m)} ${matName(m)}</span>`).join(" ");
        bodyHTML += "</div>";
      }
      showDungeonResult("defeated", "Defeated!", bodyHTML);
    } else {
      bodyHTML += "<div>You fled the dungeon.</div>";
      if (state.lootCollected.length > 0) {
        bodyHTML += "<div style='margin-top:6px'>Materials kept: ";
        bodyHTML += state.lootCollected.map(m => `<span class="loot-item">${matEmoji(m)} ${matName(m)}</span>`).join(" ");
        bodyHTML += "</div>";
      }
      if (state.goldCollected > 0) {
        bodyHTML += `<div style="margin-top:6px"><span class="loot-gold">+${state.goldCollected} Gold</span></div>`;
      }
      showDungeonResult("fled", "Fled!", bodyHTML);
    }
  }

  // ──────── INPUT ────────
  document.addEventListener("keydown", (e) => {
    keysDown.add(e.key.toLowerCase());
    if (e.key === " " && state.inDungeon) {
      e.preventDefault();
      swingSword();
    }
  });
  document.addEventListener("keyup", (e) => keysDown.delete(e.key.toLowerCase()));
  window.addEventListener("blur", () => keysDown.clear());
  window.addEventListener("resize", () => { if (state.inDungeon) resizeCanvas(); });

  // Sword mouse controls — screen-space like the sword project
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseScreenX = e.clientX - rect.left;
    mouseScreenY = e.clientY - rect.top;
  });
  canvas.addEventListener("mousedown", (e) => {
    if (state.inDungeon) { e.preventDefault(); swingSword(); }
  });

  // ──────── TRADER SELECT ────────
  function showTraderSelect() {
    const list = $("#trader-select-list");
    list.innerHTML = GAME_DATA.traders.map((t) => `<div class="trader-option" data-id="${t.id}"><h4>${t.name}</h4><p>${t.description}</p></div>`).join("");
    list.querySelectorAll(".trader-option").forEach((el) => {
      el.addEventListener("click", () => { closeModal("trader-select-modal"); enterTrade(el.dataset.id); });
    });
    openModal("trader-select-modal");
  }

  // ──────── TRADE ENGINE ────────
  function enterTrade(id) {
    const trader = GAME_DATA.traders.find((t) => t.id === id);
    if (!trader) return;
    $("#trader-name").textContent = trader.name;
    renderTradeOffers(trader); renderTradeInventory();
    showScreen("trade");
  }

  function renderTradeOffers(trader) {
    const el = $("#trader-offers");
    el.innerHTML = trader.offers.map((offer, i) => {
      const giveParts = Object.entries(offer.give).map(([m, q]) => m === "gold" ? `${q} gold` : `${matEmoji(m)} ${matName(m)} x${q}`).join(", ");
      const costParts = Object.entries(offer.cost).map(([m, q]) => m === "gold" ? `${q} gold` : `${matEmoji(m)} ${matName(m)} x${q}`).join(", ");
      const canAfford = hasMaterials(offer.cost);
      return `<div class="trade-item"><div class="item-gives">Get: ${giveParts}</div><div class="item-cost">Cost: ${costParts}</div>${canAfford ? `<button class="btn-trade-action" onclick="GAME.doTrade('${trader.id}', ${i})">Trade</button>` : `<div style="color:var(--danger);font-size:0.8rem;margin-top:4px">Can't afford</div>`}</div>`;
    }).join("");
  }

  function renderTradeInventory() {
    const el = $("#trade-inventory");
    const mats = Object.entries(state.inventory);
    el.innerHTML = `<div class="inv-row"><span class="mat-name">Gold</span><span class="mat-qty">${state.gold}</span></div>`;
    el.innerHTML += mats.map(([id, qty]) => `<div class="inv-row"><span class="mat-name">${matEmoji(id)} ${matName(id)}</span><span class="mat-qty">x${qty}</span></div>`).join("");
  }

  function doTrade(traderId, offerIndex) {
    const trader = GAME_DATA.traders.find((t) => t.id === traderId);
    const offer = trader.offers[offerIndex];
    if (!hasMaterials(offer.cost)) return;
    removeMaterials(offer.cost);
    for (const [mat, qty] of Object.entries(offer.give)) {
      if (mat === "gold") state.gold += qty; else addMaterial(mat, qty);
    }
    updateHUD(); renderTradeOffers(trader); renderTradeInventory();
  }

  // ──────── CRAFTING ────────
  function enterCraft() { renderCraftRecipes(); renderCraftInventory(); showScreen("craft"); }

  function renderCraftRecipes() {
    const el = $("#craft-recipes");
    el.innerHTML = GAME_DATA.recipes.map((r) => {
      const parts = Object.entries(r.ingredients).map(([mat, qty]) => {
        const have = state.inventory[mat] || 0;
        return `<span style="color:${have >= qty ? "var(--green)" : "var(--danger)"}">${matEmoji(mat)} ${matName(mat)} ${have}/${qty}</span>`;
      }).join(" ");
      const can = hasMaterials(r.ingredients);
      return `<div class="recipe-card"><h4>${r.emoji} ${r.name}</h4><div class="ingredients">${parts}</div><button class="btn-craft-action" ${can ? "" : "disabled"} onclick="GAME.doCraft('${r.id}')">Craft</button></div>`;
    }).join("");
  }

  function renderCraftInventory() {
    const el = $("#craft-inventory-list");
    const mats = Object.entries(state.inventory);
    const crafts = Object.entries(state.crafted);
    let html = "";
    mats.forEach(([id, qty]) => { html += `<div class="inv-row"><span class="mat-name">${matEmoji(id)} ${matName(id)}</span><span class="mat-qty">x${qty}</span></div>`; });
    if (crafts.length > 0) {
      html += "<h4 style='margin:12px 0 8px;color:var(--text-dim)'>Crafted</h4>";
      crafts.forEach(([id, qty]) => { html += `<div class="inv-row"><span class="mat-name">${recipeEmoji(id)} ${recipeName(id)}</span><span class="mat-qty">x${qty}</span></div>`; });
    }
    el.innerHTML = html || '<p class="empty-msg">No materials yet.</p>';
  }

  function doCraft(recipeId) {
    const recipe = GAME_DATA.recipes.find((r) => r.id === recipeId);
    if (!recipe || !hasMaterials(recipe.ingredients)) return;
    removeMaterials(recipe.ingredients);
    state.crafted[recipeId] = (state.crafted[recipeId] || 0) + 1;
    renderCraftRecipes(); renderCraftInventory(); updateHUD();
  }

  // ──────── ENEMY GAME REF ────────
  setEnemyGameRef({
    get ctx() { return ctx; },
    get canvas() { return canvas; },
    get camX() { return camX; },
    get camY() { return camY; },
    get state() { return state; },
    TILE,
    isSolid,
    get particles() { return particles; },
    get enemies() { return enemies; },
    get attackTokens() { return attackTokens; },
    spawnFloatingText,
    triggerShake,
    get damageFlash() { return damageFlash; },
    set damageFlash(v) { damageFlash = v; },
    fleeDungeon,
    $,
  });

  // ──────── WIRING ────────
  $("#btn-start").addEventListener("click", () => { spawnCustomers(); showScreen("shop"); updateHUD(); renderCustomers(); });
  $("#btn-inventory").addEventListener("click", showInventory);
  $("#btn-recipes").addEventListener("click", showRecipes);
  $("#btn-dungeon").addEventListener("click", showDungeonSelect);
  $("#btn-trade").addEventListener("click", showTraderSelect);
  $("#btn-craft").addEventListener("click", enterCraft);
  $("#btn-end-day").addEventListener("click", endDay);
  $("#btn-editor").addEventListener("click", () => showScreen("editor"));
  $("#btn-editor-exit").addEventListener("click", () => { showScreen("shop"); updateHUD(); renderCustomers(); });
  $("#btn-editor-test").addEventListener("click", () => {
    const level = LevelEditor.exportLevel();
    enterDungeon(null, level);
  });
  $("#btn-flee").addEventListener("click", () => fleeDungeon(false));
  $("#btn-result-continue").addEventListener("click", () => {
    $("#dungeon-result").classList.remove("active");
    showScreen("shop"); updateHUD(); renderCustomers();
  });
  $("#btn-leave-trade").addEventListener("click", () => { showScreen("shop"); updateHUD(); renderCustomers(); });
  $("#btn-leave-craft").addEventListener("click", () => { showScreen("shop"); updateHUD(); renderCustomers(); });
  $("#close-inventory").addEventListener("click", () => closeModal("inventory-modal"));
  $("#close-recipes").addEventListener("click", () => closeModal("recipes-modal"));
  $("#close-dungeon-select").addEventListener("click", () => closeModal("dungeon-select-modal"));
  $("#close-trader-select").addEventListener("click", () => closeModal("trader-select-modal"));
  document.querySelectorAll(".modal").forEach((m) => { m.addEventListener("click", (e) => { if (e.target === m) m.classList.remove("active"); }); });

  window.GAME = { sellTo, doTrade, doCraft };

})();
