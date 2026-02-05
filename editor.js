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

  // ── Rendering ──
  function render() {
    if (!canvas || !ctx) {
      requestAnimationFrame(render);
      return;
    }

    const theme = THEMES[themeIndex];
    ctx.fillStyle = theme.floorColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const startCol = Math.floor(camX / TILE);
    const startRow = Math.floor(camY / TILE);
    const endCol = Math.min(MAP_COLS, startCol + Math.ceil(canvas.width / TILE) + 1);
    const endRow = Math.min(MAP_ROWS, startRow + Math.ceil(canvas.height / TILE) + 1);

    // Draw tiles
    for (let r = startRow; r < endRow; r++) {
      for (let c = startCol; c < endCol; c++) {
        const sx = c * TILE - camX;
        const sy = r * TILE - camY;
        const tile = map[r]?.[c] ?? 0;

        if (tile === 1) {
          // Wall
          ctx.fillStyle = theme.wallColor;
          ctx.fillRect(sx, sy, TILE, TILE);
          ctx.strokeStyle = "rgba(0,0,0,0.3)";
          ctx.lineWidth = 1;
          ctx.strokeRect(sx + 0.5, sy + 0.5, TILE - 1, TILE - 1);
        } else {
          // Floor
          ctx.fillStyle = theme.floorColor;
          ctx.fillRect(sx, sy, TILE, TILE);
          // Subtle grid
          ctx.strokeStyle = "rgba(255,255,255,0.05)";
          ctx.lineWidth = 0.5;
          ctx.strokeRect(sx, sy, TILE, TILE);
        }

        // Draw special tiles
        if (tile === 2) drawIcon(sx, sy, "#88f", "L"); // Loot
        if (tile === 3) drawIcon(sx, sy, "#f44", "!"); // Trap
        if (tile === 4) drawIcon(sx, sy, "#f84", "E"); // Enemy
        if (tile === 5) drawIcon(sx, sy, "#4f4", "X"); // Exit
        if (tile === 6) drawIcon(sx, sy, "#fd0", "$"); // Gold
        if (tile === 7) drawIcon(sx, sy, "#f4a", "+"); // Health
      }
    }

    // Draw start position
    const startSX = startPos.col * TILE - camX;
    const startSY = startPos.row * TILE - camY;
    ctx.fillStyle = "#4f4";
    ctx.beginPath();
    ctx.arc(startSX + TILE / 2, startSY + TILE / 2, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("S", startSX + TILE / 2, startSY + TILE / 2);

    requestAnimationFrame(render);
  }

  function drawIcon(sx, sy, color, letter) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(sx + TILE / 2, sy + TILE / 2, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(letter, sx + TILE / 2, sy + TILE / 2);
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
