/* ============================================
   Level Editor — Shopkeeper's Quest
   ============================================ */

const LevelEditor = (function() {
  "use strict";

  // ── Constants ──
  const TILE = 32;
  const MAP_COLS = 50;
  const MAP_ROWS = 40;

  // ── Themes ──
  const THEMES = [
    {
      name: "Forest",
      id: "forest",
      wallStyle: "tree",
      floorStyle: "grass",
      wallColor: "#2a5a2a",
      floorColor: "#1a3a1a",
      floorAccent: "#2a4a1a",
    },
    {
      name: "Cave",
      id: "cave",
      wallStyle: "rock",
      floorStyle: "stone",
      wallColor: "#5a4a3a",
      floorColor: "#2a2a3a",
      floorAccent: "#333344",
    },
    {
      name: "Lava",
      id: "lava",
      wallStyle: "obsidian",
      floorStyle: "scorched",
      wallColor: "#3a2020",
      floorColor: "#2a1a1a",
      floorAccent: "#331111",
    },
  ];

  // ── Tile types ──
  const TILE_TYPES = {
    floor: 0,
    wall: 1,
    loot: 2,
    trap: 3,
    enemy: 4,
    exit: 5,
    gold: 6,
    health: 7,
    start: 10, // special marker, converted to floor + startPixel
  };

  // ── State ──
  let canvas, ctx;
  let map = [];
  let themeIndex = 0;
  let currentTool = "wall";
  let currentBrush = "square";
  let brushSize = 2;
  let startPos = { col: 2, row: 2 };

  // Camera / pan
  let camX = 0, camY = 0;
  let isDragging = false;
  let isPanning = false;
  let lastMouse = { x: 0, y: 0 };

  // ── Initialize ──
  function init() {
    canvas = document.getElementById("editor-canvas");
    if (!canvas) return;
    ctx = canvas.getContext("2d");

    // Resize canvas to container
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Create blank map with border walls
    clearMap();

    // Tool buttons
    document.querySelectorAll(".tool-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentTool = btn.dataset.tool;
      });
    });

    // Brush buttons
    document.querySelectorAll(".brush-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".brush-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentBrush = btn.dataset.brush;
      });
    });

    // Brush size slider
    const sizeSlider = document.getElementById("brush-size");
    const sizeLabel = document.getElementById("brush-size-label");
    if (sizeSlider) {
      sizeSlider.addEventListener("input", () => {
        brushSize = parseInt(sizeSlider.value);
        sizeLabel.textContent = brushSize;
      });
    }

    // Theme cycle
    document.getElementById("btn-theme-cycle")?.addEventListener("click", cycleTheme);

    // Clear button
    document.getElementById("btn-editor-clear")?.addEventListener("click", clearMap);

    // Canvas events
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mouseleave", onMouseUp);
    canvas.addEventListener("wheel", onWheel);
    canvas.addEventListener("contextmenu", e => e.preventDefault());

    // Start render loop
    requestAnimationFrame(render);
  }

  function resizeCanvas() {
    if (!canvas) return;
    const parent = canvas.parentElement;
    canvas.width = parent.clientWidth - 180; // subtract tools panel width
    canvas.height = parent.clientHeight;
  }

  function clearMap() {
    map = [];
    for (let r = 0; r < MAP_ROWS; r++) {
      const row = [];
      for (let c = 0; c < MAP_COLS; c++) {
        // Border walls
        if (r === 0 || r === MAP_ROWS - 1 || c === 0 || c === MAP_COLS - 1) {
          row.push(1);
        } else {
          row.push(0);
        }
      }
      map.push(row);
    }
    startPos = { col: 2, row: 2 };
    camX = 0;
    camY = 0;
  }

  function cycleTheme() {
    themeIndex = (themeIndex + 1) % THEMES.length;
    const label = document.getElementById("editor-theme-label");
    if (label) label.textContent = "Theme: " + THEMES[themeIndex].name;
  }

  // ── Mouse Handling ──
  function onMouseDown(e) {
    if (e.button === 1 || e.button === 2) {
      // Middle or right click = pan
      isPanning = true;
      lastMouse = { x: e.clientX, y: e.clientY };
      return;
    }
    isDragging = true;
    paint(e);
  }

  function onMouseMove(e) {
    if (isPanning) {
      const dx = e.clientX - lastMouse.x;
      const dy = e.clientY - lastMouse.y;
      camX -= dx;
      camY -= dy;
      clampCamera();
      lastMouse = { x: e.clientX, y: e.clientY };
      return;
    }
    if (isDragging) {
      paint(e);
    }
  }

  function onMouseUp() {
    isDragging = false;
    isPanning = false;
  }

  function onWheel(e) {
    e.preventDefault();
    camX += e.deltaX;
    camY += e.deltaY;
    clampCamera();
  }

  function clampCamera() {
    const maxX = MAP_COLS * TILE - canvas.width;
    const maxY = MAP_ROWS * TILE - canvas.height;
    camX = Math.max(0, Math.min(maxX, camX));
    camY = Math.max(0, Math.min(maxY, camY));
  }

  // ── Painting ──
  function paint(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left + camX;
    const my = e.clientY - rect.top + camY;
    const col = Math.floor(mx / TILE);
    const row = Math.floor(my / TILE);

    const tileValue = TILE_TYPES[currentTool] ?? 0;

    // For single-placement tools (enemy, start, exit, etc), just set one tile
    if (["enemy", "start", "exit", "loot", "gold", "health", "trap"].includes(currentTool)) {
      if (row > 0 && row < MAP_ROWS - 1 && col > 0 && col < MAP_COLS - 1) {
        if (currentTool === "start") {
          // Clear old start
          startPos = { col, row };
          map[row][col] = 0;
        } else {
          map[row][col] = tileValue;
        }
      }
      return;
    }

    // Brush-based painting for wall/floor
    const tiles = getBrushTiles(col, row, brushSize, currentBrush);
    for (const [c, r] of tiles) {
      if (r > 0 && r < MAP_ROWS - 1 && c > 0 && c < MAP_COLS - 1) {
        map[r][c] = tileValue;
      }
    }
  }

  function getBrushTiles(cx, cy, size, brush) {
    const tiles = [];
    const half = Math.floor(size / 2);

    if (brush === "square") {
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          tiles.push([cx + dx, cy + dy]);
        }
      }
    } else if (brush === "circle") {
      const r = size / 2;
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          if (dx * dx + dy * dy <= r * r + 0.5) {
            tiles.push([cx + dx, cy + dy]);
          }
        }
      }
    } else if (brush.startsWith("curve-")) {
      // Curved corners - creates smooth arcs
      const corner = brush.slice(6); // tl, tr, bl, br
      for (let dy = 0; dy <= size; dy++) {
        for (let dx = 0; dx <= size; dx++) {
          let inCurve = false;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (corner === "tl") {
            inCurve = dist <= size;
            tiles.push([cx - dx, cy - dy]);
          } else if (corner === "tr") {
            inCurve = dist <= size;
            tiles.push([cx + dx, cy - dy]);
          } else if (corner === "bl") {
            inCurve = dist <= size;
            tiles.push([cx - dx, cy + dy]);
          } else if (corner === "br") {
            inCurve = dist <= size;
            tiles.push([cx + dx, cy + dy]);
          }
        }
      }
    }

    return tiles;
  }

  // ── 2.5D Rendering ──
  const WALL_HEIGHT = 18; // How tall walls appear
  const SHADOW_OFFSET = 6; // Shadow cast distance

  function render() {
    if (!canvas || !ctx) {
      requestAnimationFrame(render);
      return;
    }

    const theme = THEMES[themeIndex];

    // Dark ambient background
    ctx.fillStyle = darken(theme.floorColor, 0.3);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const startCol = Math.max(0, Math.floor(camX / TILE) - 1);
    const startRow = Math.max(0, Math.floor(camY / TILE) - 1);
    const endCol = Math.min(MAP_COLS, startCol + Math.ceil(canvas.width / TILE) + 2);
    const endRow = Math.min(MAP_ROWS, startRow + Math.ceil(canvas.height / TILE) + 2);

    // Pass 1: Draw floor tiles with texture
    for (let r = startRow; r < endRow; r++) {
      for (let c = startCol; c < endCol; c++) {
        const sx = c * TILE - camX;
        const sy = r * TILE - camY;
        const tile = map[r]?.[c] ?? 0;

        if (tile !== 1) {
          drawFloorTile(sx, sy, c, r, theme);
        }
      }
    }

    // Pass 2: Draw wall shadows (cast onto floor)
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    for (let r = startRow; r < endRow; r++) {
      for (let c = startCol; c < endCol; c++) {
        if (map[r]?.[c] === 1) {
          const sx = c * TILE - camX;
          const sy = r * TILE - camY;
          // Shadow extends down-right
          ctx.beginPath();
          ctx.moveTo(sx + TILE, sy + TILE);
          ctx.lineTo(sx + TILE + SHADOW_OFFSET, sy + TILE + SHADOW_OFFSET);
          ctx.lineTo(sx + TILE + SHADOW_OFFSET, sy + SHADOW_OFFSET);
          ctx.lineTo(sx + TILE, sy);
          ctx.closePath();
          ctx.fill();
          // Bottom shadow
          ctx.beginPath();
          ctx.moveTo(sx, sy + TILE);
          ctx.lineTo(sx + SHADOW_OFFSET, sy + TILE + SHADOW_OFFSET);
          ctx.lineTo(sx + TILE + SHADOW_OFFSET, sy + TILE + SHADOW_OFFSET);
          ctx.lineTo(sx + TILE, sy + TILE);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // Pass 3: Draw special tiles (on floor, before walls)
    for (let r = startRow; r < endRow; r++) {
      for (let c = startCol; c < endCol; c++) {
        const sx = c * TILE - camX;
        const sy = r * TILE - camY;
        const tile = map[r]?.[c] ?? 0;

        if (tile === 2) drawItem3D(sx, sy, "#6688ff", "#4466dd", "crystal");
        if (tile === 3) drawTrap3D(sx, sy);
        if (tile === 5) drawExit3D(sx, sy);
        if (tile === 6) drawItem3D(sx, sy, "#ffd700", "#cc9900", "coin");
        if (tile === 7) drawItem3D(sx, sy, "#ff66aa", "#dd4488", "potion");
      }
    }

    // Pass 4: Draw start position
    const startSX = startPos.col * TILE - camX;
    const startSY = startPos.row * TILE - camY;
    // Glowing circle
    ctx.fillStyle = "rgba(100,255,100,0.2)";
    ctx.beginPath();
    ctx.arc(startSX + TILE / 2, startSY + TILE / 2, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#4f4";
    ctx.beginPath();
    ctx.arc(startSX + TILE / 2, startSY + TILE / 2, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("S", startSX + TILE / 2, startSY + TILE / 2);

    // Pass 5: Draw enemies (floating above floor)
    for (let r = startRow; r < endRow; r++) {
      for (let c = startCol; c < endCol; c++) {
        const tile = map[r]?.[c] ?? 0;
        if (tile === 4) {
          const sx = c * TILE - camX;
          const sy = r * TILE - camY;
          drawEnemy3D(sx, sy, theme);
        }
      }
    }

    // Pass 6: Draw raised walls (back to front for proper overlap)
    for (let r = startRow; r < endRow; r++) {
      for (let c = startCol; c < endCol; c++) {
        if (map[r]?.[c] === 1) {
          const sx = c * TILE - camX;
          const sy = r * TILE - camY;
          drawWall3D(sx, sy, c, r, theme);
        }
      }
    }

    requestAnimationFrame(render);
  }

  function drawFloorTile(sx, sy, c, r, theme) {
    // Base floor
    ctx.fillStyle = theme.floorColor;
    ctx.fillRect(sx, sy, TILE, TILE);

    // Procedural texture based on position
    const seed = (c * 7 + r * 13) % 100;

    if (theme.id === "forest") {
      // Grass tufts
      ctx.fillStyle = theme.floorAccent;
      if (seed < 30) {
        ctx.fillRect(sx + 8 + (seed % 10), sy + 12, 3, 6);
        ctx.fillRect(sx + 20 + (seed % 8), sy + 8, 2, 5);
      }
      // Occasional flower
      if (seed > 90) {
        const colors = ["#d44", "#dd4", "#d4d"];
        ctx.fillStyle = colors[seed % 3];
        ctx.beginPath();
        ctx.arc(sx + 16, sy + 16, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (theme.id === "cave") {
      // Stone texture / pebbles
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      if (seed < 40) {
        ctx.fillRect(sx + (seed % 20) + 4, sy + ((seed * 3) % 20) + 4, 4, 3);
      }
      // Cracks
      if (seed > 70) {
        ctx.strokeStyle = "rgba(0,0,0,0.15)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx + 5, sy + 10 + (seed % 10));
        ctx.lineTo(sx + 20 + (seed % 8), sy + 15);
        ctx.stroke();
      }
    } else {
      // Lava - scorched ground with cracks
      ctx.fillStyle = "rgba(0,0,0,0.1)";
      ctx.fillRect(sx + (seed % 15), sy + (seed % 12), 8, 6);
      // Glowing cracks
      if (seed > 60) {
        ctx.strokeStyle = `rgba(255,${80 + seed % 50},0,0.3)`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx + 2, sy + 15 + (seed % 10));
        ctx.lineTo(sx + 25 + (seed % 5), sy + 20);
        ctx.stroke();
      }
    }

    // Subtle grid lines (inset)
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(sx + 1, sy + 1, TILE - 2, TILE - 2);
  }

  function drawWall3D(sx, sy, c, r, theme) {
    const wallTop = sy - WALL_HEIGHT;

    // Check neighbors for edge detection
    const hasWallBelow = map[r + 1]?.[c] === 1;
    const hasWallRight = map[r]?.[c + 1] === 1;

    // Wall top face (lighter)
    ctx.fillStyle = lighten(theme.wallColor, 0.25);
    ctx.fillRect(sx, wallTop, TILE, WALL_HEIGHT);

    // Wall front face (if no wall below)
    if (!hasWallBelow) {
      ctx.fillStyle = theme.wallColor;
      ctx.fillRect(sx, sy, TILE, TILE);

      // Front face shading (darker at bottom)
      const grad = ctx.createLinearGradient(sx, sy, sx, sy + TILE);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.3)");
      ctx.fillStyle = grad;
      ctx.fillRect(sx, sy, TILE, TILE);
    }

    // Right edge highlight
    if (!hasWallRight) {
      ctx.fillStyle = darken(theme.wallColor, 0.2);
      ctx.fillRect(sx + TILE - 3, wallTop, 3, WALL_HEIGHT + (hasWallBelow ? 0 : TILE));
    }

    // Top edge highlight
    ctx.fillStyle = lighten(theme.wallColor, 0.4);
    ctx.fillRect(sx, wallTop, TILE, 2);

    // Theme-specific wall details
    if (theme.id === "forest") {
      // Tree bark texture
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      const seed = (c * 11 + r * 17) % 50;
      ctx.fillRect(sx + 5 + seed % 15, wallTop + 4, 2, WALL_HEIGHT - 6);
      ctx.fillRect(sx + 18 + seed % 8, wallTop + 6, 2, WALL_HEIGHT - 8);
      // Leaves on top
      ctx.fillStyle = "#3a7a3a";
      ctx.beginPath();
      ctx.arc(sx + 8, wallTop - 2, 6, 0, Math.PI * 2);
      ctx.arc(sx + 22, wallTop - 1, 5, 0, Math.PI * 2);
      ctx.arc(sx + 15, wallTop - 4, 7, 0, Math.PI * 2);
      ctx.fill();
    } else if (theme.id === "cave") {
      // Rocky texture
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      const seed = (c * 7 + r * 23) % 40;
      ctx.fillRect(sx + 3 + seed % 10, wallTop + 5, 8, 4);
      ctx.fillRect(sx + 18 + seed % 8, wallTop + 10, 6, 3);
    } else {
      // Obsidian with lava glow
      ctx.fillStyle = "rgba(255,68,0,0.15)";
      ctx.fillRect(sx + 2, wallTop + WALL_HEIGHT - 4, TILE - 4, 4);
      // Glowing cracks
      const seed = (c * 13 + r * 19) % 60;
      if (seed > 30) {
        ctx.strokeStyle = "rgba(255,100,0,0.4)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx + 5, wallTop + 8);
        ctx.lineTo(sx + 12 + seed % 10, wallTop + WALL_HEIGHT - 3);
        ctx.stroke();
      }
    }
  }

  function drawItem3D(sx, sy, color, darkColor, type) {
    const cx = sx + TILE / 2;
    const cy = sy + TILE / 2;
    const bob = Math.sin(performance.now() / 300 + sx * 0.1) * 2;

    // Shadow on ground
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + 8, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Floating item
    if (type === "crystal") {
      // Diamond shape
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 10 + bob);
      ctx.lineTo(cx + 7, cy + bob);
      ctx.lineTo(cx, cy + 8 + bob);
      ctx.lineTo(cx - 7, cy + bob);
      ctx.closePath();
      ctx.fill();
      // Highlight
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.beginPath();
      ctx.moveTo(cx, cy - 10 + bob);
      ctx.lineTo(cx + 3, cy - 2 + bob);
      ctx.lineTo(cx, cy + bob);
      ctx.lineTo(cx - 3, cy - 2 + bob);
      ctx.closePath();
      ctx.fill();
    } else if (type === "coin") {
      // Spinning coin effect
      const squeeze = Math.abs(Math.cos(performance.now() / 200));
      ctx.fillStyle = darkColor;
      ctx.beginPath();
      ctx.ellipse(cx, cy - 3 + bob, 6 * squeeze + 1, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(cx, cy - 4 + bob, 5 * squeeze + 1, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Potion bottle
      ctx.fillStyle = darkColor;
      ctx.fillRect(cx - 4, cy - 8 + bob, 8, 12);
      ctx.fillStyle = color;
      ctx.fillRect(cx - 3, cy - 6 + bob, 6, 8);
      ctx.fillStyle = "#888";
      ctx.fillRect(cx - 2, cy - 10 + bob, 4, 3);
      // Shine
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillRect(cx - 1, cy - 5 + bob, 2, 5);
    }
  }

  function drawTrap3D(sx, sy) {
    const cx = sx + TILE / 2;
    const cy = sy + TILE / 2;

    // Spikes
    ctx.fillStyle = "#666";
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + performance.now() / 2000;
      const spx = cx + Math.cos(angle) * 8;
      const spy = cy + Math.sin(angle) * 8;
      ctx.beginPath();
      ctx.moveTo(spx, spy - 8);
      ctx.lineTo(spx + 3, spy + 2);
      ctx.lineTo(spx - 3, spy + 2);
      ctx.closePath();
      ctx.fill();
    }
    // Center
    ctx.fillStyle = "#444";
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
    // Danger glow
    ctx.fillStyle = "rgba(255,0,0,0.15)";
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawExit3D(sx, sy) {
    const cx = sx + TILE / 2;
    const cy = sy + TILE / 2;
    const pulse = 0.8 + Math.sin(performance.now() / 400) * 0.2;

    // Glowing portal
    ctx.fillStyle = `rgba(100,255,150,${0.15 * pulse})`;
    ctx.beginPath();
    ctx.arc(cx, cy, 14 * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(150,255,200,${0.3 * pulse})`;
    ctx.beginPath();
    ctx.arc(cx, cy, 10 * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#4f8";
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();

    // Arrow pointing up
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(cx, cy - 4);
    ctx.lineTo(cx + 3, cy + 1);
    ctx.lineTo(cx - 3, cy + 1);
    ctx.closePath();
    ctx.fill();
  }

  function drawEnemy3D(sx, sy, theme) {
    const cx = sx + TILE / 2;
    const cy = sy + TILE / 2;
    const bob = Math.sin(performance.now() / 400 + sx * 0.05) * 2;

    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + 10, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body color based on theme
    let bodyColor = "#c44";
    if (theme.id === "forest") bodyColor = "#5a3a5a";
    else if (theme.id === "cave") bodyColor = "#7a7a6a";
    else bodyColor = "#dd5522";

    // Body
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.arc(cx, cy - 4 + bob, 10, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(cx - 3, cy - 5 + bob, 3, 0, Math.PI * 2);
    ctx.arc(cx + 3, cy - 5 + bob, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(cx - 3, cy - 4 + bob, 1.5, 0, Math.PI * 2);
    ctx.arc(cx + 3, cy - 4 + bob, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Angry eyebrows
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy - 9 + bob);
    ctx.lineTo(cx - 1, cy - 7 + bob);
    ctx.moveTo(cx + 6, cy - 9 + bob);
    ctx.lineTo(cx + 1, cy - 7 + bob);
    ctx.stroke();
  }

  // Color utilities
  function lighten(hex, amount) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.min(255, (num >> 16) + Math.round(255 * amount));
    const g = Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * amount));
    const b = Math.min(255, (num & 0xff) + Math.round(255 * amount));
    return `rgb(${r},${g},${b})`;
  }

  function darken(hex, amount) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.max(0, (num >> 16) - Math.round(255 * amount));
    const g = Math.max(0, ((num >> 8) & 0xff) - Math.round(255 * amount));
    const b = Math.max(0, (num & 0xff) - Math.round(255 * amount));
    return `rgb(${r},${g},${b})`;
  }

  // ── Export Level ──
  function exportLevel() {
    const theme = THEMES[themeIndex];

    // Build the full theme object based on template
    let fullTheme;
    if (theme.id === "forest") {
      fullTheme = {
        wallStyle: "tree",
        floorStyle: "grass",
        trunkColor: "#5a3a1a",
        trunkDark: "#3a2210",
        canopyColor: "#2a6a2a",
        canopyLight: "#3a8a3a",
        canopyDark: "#1a4a1a",
        bushColor: "#2a5a20",
        grassColor: "#2a4a1a",
        grassLight: "#3a6a2a",
        flowerColors: ["#d44", "#dd4", "#d4d", "#44d"],
        leafColor: "#4a3a1a",
      };
    } else if (theme.id === "cave") {
      fullTheme = {
        wallStyle: "rock",
        floorStyle: "stone",
        wallBase: "#6b5544",
        wallHighlight: "#8a7766",
        wallShadow: "#3a2a22",
        crackColor: "#888",
        oreVeinColor: "#a08050",
        floorAccent: "#333344",
        pebbleColor: "#555566",
        beamColor: "#8a6a40",
      };
    } else {
      fullTheme = {
        wallStyle: "obsidian",
        floorStyle: "scorched",
        rockColor: "#2a2028",
        rockHighlight: "#4a3a44",
        lavaGlow: "#ff4400",
        lavaDim: "#aa2200",
        crackGlow: "#ff6622",
        ashColor: "#3a2a2a",
        emberColor: "#ff6633",
        scorchColor: "#221111",
        scorchLine: "#441a1a",
      };
    }

    // Count enemies for HP scaling
    let enemyCount = 0;
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        if (map[r][c] === 4) enemyCount++;
      }
    }

    return {
      id: "custom_" + Date.now(),
      name: "Custom Level",
      description: "A custom-made dungeon.",
      difficulty: Math.max(1, Math.min(4, Math.ceil(enemyCount / 3))),
      loot: ["iron_ore", "copper_ore", "wood", "mushroom", "herb"],
      playerHP: 10,
      trapDamage: 2,
      enemyDamage: 3,
      enemyHP: 2 + Math.floor(enemyCount / 4),
      enemyTypes: getEnemyTypesForTheme(theme.id),
      floorColor: theme.floorColor,
      wallColor: theme.wallColor,
      ambientColor: "#0a0a15",
      theme: fullTheme,
      startPixel: [startPos.col * TILE + TILE / 2, startPos.row * TILE + TILE / 2],
      map: map.map(row => [...row]),
    };
  }

  function getEnemyTypesForTheme(themeId) {
    if (themeId === "forest") {
      return [
        { name: "Spider", bodyColor: "#5a3a5a", eyeColor: "#f44", size: 10, shape: "spider" },
        { name: "Wisp", bodyColor: "#3a8a4a", eyeColor: "#afa", size: 8, shape: "wisp" },
      ];
    } else if (themeId === "cave") {
      return [
        { name: "Golem", bodyColor: "#7a7a6a", eyeColor: "#ff4", size: 12, shape: "square" },
        { name: "Bat", bodyColor: "#4a4a5a", eyeColor: "#f44", size: 7, shape: "bat" },
      ];
    } else {
      return [
        { name: "Fire Imp", bodyColor: "#dd5522", eyeColor: "#ff0", size: 9, shape: "imp" },
        { name: "Lava Slime", bodyColor: "#aa3311", eyeColor: "#ff6", size: 13, shape: "slime" },
      ];
    }
  }

  // ── Public API ──
  return {
    init,
    exportLevel,
    clearMap,
  };
})();

// Auto-init when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  // Only init when editor screen is shown
  const editorScreen = document.getElementById("editor-screen");
  if (editorScreen) {
    const observer = new MutationObserver(() => {
      if (editorScreen.classList.contains("active")) {
        LevelEditor.init();
        observer.disconnect();
      }
    });
    observer.observe(editorScreen, { attributes: true, attributeFilter: ["class"] });
  }
});
