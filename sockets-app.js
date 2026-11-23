(function () {
  "use strict";

  const DATA = window.SOCKETS_DATA;
  if (!DATA) {
    console.error("SOCKETS_DATA is not loaded.");
    return;
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  const STORAGE_KEY = "sockets_editor_v1_state";

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  const BASELINE_GROUPS = deepClone(DATA.groups);
  const BASELINE_BLOCKS = deepClone(DATA.blocks);
  const wallById = new Map(DATA.wallSegments.map((w) => [w.id, w]));

  const state = {
    groups: deepClone(BASELINE_GROUPS),
    blocks: deepClone(BASELINE_BLOCKS),
    activeGroups: { G12: true },
    selectedBlockId: null,
    hoveredBlockId: null,
    activeTab: "blocks",
    showDims: true,
    zoom: 1,
    panX: 0,
    panY: 0
  };

  // DOM References
  const viewportEl = document.getElementById("canvas-viewport");
  const stageEl = document.getElementById("plan-stage");
  const wallGuidesEl = document.getElementById("layer-wall-guides");
  const powerWiresEl = document.getElementById("layer-power-wires");
  const dimsLayerEl = document.getElementById("layer-dims");
  const socketsLayerEl = document.getElementById("layer-sockets");
  const inspectorEl = document.getElementById("selected-inspector");
  const tabContentEl = document.getElementById("tab-content");
  const statSocketsEl = document.getElementById("stat-sockets");
  const statRj45El = document.getElementById("stat-rj45");
  const statWattsEl = document.getElementById("stat-watts");
  const tabBlocksCountEl = document.getElementById("tab-blocks-count");
  const editsBtnCountEl = document.getElementById("edits-btn-count");
  const editsTabCountEl = document.getElementById("edits-tab-count");
  const zoomReadoutEl = document.getElementById("zoom-readout");
  const btnToggleDimsEl = document.getElementById("btn-toggle-dims");
  const modalBackdropEl = document.getElementById("modal-backdrop");
  const modalBoxEl = document.getElementById("modal-box");

  let suppressNextClick = false;

  /* ==================== PERSISTENCE ==================== */

  function saveToStorage() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          groups: state.groups,
          blocks: state.blocks,
          activeGroups: state.activeGroups,
          showDims: state.showDims
        })
      );
    } catch (e) {}
  }

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.groups) && Array.isArray(parsed.blocks)) {
        state.groups = parsed.groups;
        state.blocks = parsed.blocks;
        state.activeGroups = parsed.activeGroups || { G12: true };
        state.showDims = parsed.showDims !== false;
      }
    } catch (e) {}
  }

  /* ==================== WALL GEOMETRY & MM OFFSET HELPERS ==================== */

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function createSvgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
    return el;
  }

  function getGroupById(gid) {
    return state.groups.find((g) => g.id === gid) || state.groups[0] || null;
  }

  function getBlockById(bid) {
    return state.blocks.find((b) => b.id === bid) || null;
  }

  function getWallEndpoints(wall, refSide) {
    const dx = wall.x2 - wall.x1;
    const dy = wall.y2 - wall.y1;
    const isHorizontal = Math.abs(dx) >= Math.abs(dy);
    let leftPt, rightPt;
    if (isHorizontal) {
      leftPt = wall.x1 <= wall.x2 ? { x: wall.x1, y: wall.y1 } : { x: wall.x2, y: wall.y2 };
      rightPt = wall.x1 <= wall.x2 ? { x: wall.x2, y: wall.y2 } : { x: wall.x1, y: wall.y1 };
    } else {
      const topPt = wall.y1 <= wall.y2 ? { x: wall.x1, y: wall.y1 } : { x: wall.x2, y: wall.y2 };
      const botPt = wall.y1 <= wall.y2 ? { x: wall.x2, y: wall.y2 } : { x: wall.x1, y: wall.y1 };
      // Facing wall from inside room: on right-side wall (normal="left"), left=top, right=bottom; on left-side wall (normal="right"), left=bottom, right=top
      if (wall.normal === "right") {
        leftPt = botPt;
        rightPt = topPt;
      } else {
        leftPt = topPt;
        rightPt = botPt;
      }
    }
    if (refSide === "right") {
      return { origin: rightPt, far: leftPt, isHorizontal };
    }
    return { origin: leftPt, far: rightPt, isHorizontal };
  }

  function projectOntoSegment(px, py, x1, y1, x2, y2) {
    const vx = x2 - x1;
    const vy = y2 - y1;
    const lenSq = vx * vx + vy * vy || 1;
    let t = ((px - x1) * vx + (py - y1) * vy) / lenSq;
    t = Math.max(0.02, Math.min(0.98, t));
    const projX = x1 + vx * t;
    const projY = y1 + vy * t;
    const dist = Math.hypot(px - projX, py - projY);
    return { x: Math.round(projX), y: Math.round(projY), t, dist };
  }

  function findNearestWall(px, py, maxDist) {
    let best = null;
    let bestDist = typeof maxDist === "number" ? maxDist : 58;
    DATA.wallSegments.forEach((wall) => {
      const pr = projectOntoSegment(px, py, wall.x1, wall.y1, wall.x2, wall.y2);
      if (pr.dist < bestDist) {
        bestDist = pr.dist;
        best = { wall, x: pr.x, y: pr.y, dist: pr.dist };
      }
    });
    return best;
  }

  function syncOffsetFromBlockCoords(block) {
    if (!block.wallId) return;
    const wall = wallById.get(block.wallId);
    if (!wall) return;
    const { origin, far } = getWallEndpoints(wall, block.refSide === "right" ? "right" : "left");
    const pr = projectOntoSegment(block.x, block.y, origin.x, origin.y, far.x, far.y);
    block.x = pr.x;
    block.y = pr.y;
    block.offsetMm = Math.round(pr.t * wall.lengthMm);
  }

  function moveBlockToWallOffset(block, wall, refSide, offsetMm) {
    const clampedMm = Math.max(0, Math.min(wall.lengthMm, Math.round(Number(offsetMm) || 0)));
    const { origin, far } = getWallEndpoints(wall, refSide);
    const t = wall.lengthMm > 0 ? clampedMm / wall.lengthMm : 0.5;
    block.wallId = wall.id;
    block.refSide = refSide;
    block.offsetMm = clampedMm;
    block.x = Math.round(origin.x + (far.x - origin.x) * t);
    block.y = Math.round(origin.y + (far.y - origin.y) * t);
    if (wall.room) block.room = wall.room;
  }

  function formatBlockTypeSummary(b) {
    if (b.kind === "power") return "Силовой 3×6,0";
    if (b.kind === "cable") return "Кабельный вывод";
    if (b.kind === "thermo") return "Терморегулятор ТП";
    if (b.kind === "shield") return "Щит ЩР";
    const parts = [];
    if (b.sockets > 0) parts.push(`${b.sockets}-пост.${b.ip44 ? " IP44+" : ""}`);
    if (b.rj45 > 0) parts.push(`${b.rj45}×RJ-45`);
    if (!parts.length) return "Пустой пост";
    return parts.join(" + ");
  }

  function getGroupTotals(gid) {
    const grp = getGroupById(gid);
    const members = state.blocks.filter((b) => b.groupId === gid && b.kind !== "shield");
    const watts = members.reduce((s, b) => s + (Number(b.watts) || 0), 0);
    const socketsCount = members.reduce((s, b) => s + (Number(b.sockets) || 0), 0);
    const rj45Count = members.reduce((s, b) => s + (Number(b.rj45) || 0), 0);
    const amps = watts / 230;
    const maxWatts = grp ? grp.maxWatts : 3680;
    const pct = Math.min(100, Math.round((watts / maxWatts) * 100));
    return { watts, socketsCount, rj45Count, amps, maxWatts, pct, overload: watts > maxWatts, count: members.length };
  }

  /* ==================== DIFF / EDITS ENGINE ==================== */

  function computeEditsSummary() {
    const diffs = [];
    const baseGrpMap = new Map(BASELINE_GROUPS.map((g) => [g.id, g]));
    const baseBlkMap = new Map(BASELINE_BLOCKS.map((b) => [b.id, b]));

    state.groups.forEach((g) => {
      const bg = baseGrpMap.get(g.id);
      if (!bg) {
        diffs.push(`Добавлена группа щита ${g.code} («${g.name}», ${g.breaker}, лимит ${g.maxWatts} Вт)`);
      } else if (bg.name !== g.name || bg.breaker !== g.breaker || bg.maxWatts !== g.maxWatts) {
        diffs.push(`Изменена группа ${g.code}: «${g.name}» (${g.breaker}, ${g.maxWatts} Вт)`);
      }
    });

    state.blocks.forEach((b) => {
      const base = baseBlkMap.get(b.id);
      const grp = getGroupById(b.groupId);
      const grpCode = grp ? grp.code : b.groupId;
      const wall = b.wallId ? wallById.get(b.wallId) : null;
      const sideTxt = b.refSide === "right" ? "от правой стены" : "от левой стены";
      const posTxt = wall ? `${wall.label}, ${b.offsetMm} мм ${sideTxt}` : `свободно (${b.x}, ${b.y})`;

      if (!base) {
        diffs.push(
          `Добавлена точка ${b.id} (${b.room} — «${b.title}»): ${formatBlockTypeSummary(b)}, ${grpCode}, h=${b.heightMm} мм, ${posTxt}, ${b.watts} Вт`
        );
        return;
      }

      const changes = [];
      if (b.sockets !== base.sockets || b.rj45 !== base.rj45 || b.ip44 !== base.ip44 || b.kind !== base.kind) {
        changes.push(`состав: ${formatBlockTypeSummary(base)} → ${formatBlockTypeSummary(b)}`);
      }
      if (b.groupId !== base.groupId) {
        const oldG = baseGrpMap.get(base.groupId);
        changes.push(`группа ЩР: ${oldG ? oldG.code : base.groupId} → ${grpCode}`);
      }
      if (b.heightMm !== base.heightMm) {
        changes.push(`высота h: ${base.heightMm} → ${b.heightMm} мм`);
      }
      if (b.wallId !== base.wallId || b.offsetMm !== base.offsetMm || b.refSide !== base.refSide || Math.hypot(b.x - base.x, b.y - base.y) >= 4) {
        changes.push(`позиция: ${posTxt}`);
      }
      if (Number(b.watts) !== Number(base.watts)) {
        changes.push(`мощность: ${base.watts} → ${b.watts} Вт`);
      }
      if (b.title !== base.title) {
        changes.push(`название: «${b.title}»`);
      }
      if ((b.comment || "").trim() !== (base.comment || "").trim()) {
        changes.push(`комментарий: ${b.comment.trim()}`);
      }
      if (changes.length) {
        diffs.push(`Изменена точка ${b.id} (${b.room}): ${changes.join("; ")}`);
      }
    });

    BASELINE_BLOCKS.forEach((base) => {
      if (!getBlockById(base.id)) {
        diffs.push(`Удалена точка ${base.id} (${base.room} — «${base.title}»)`);
      }
    });

    return diffs;
  }

  function buildExportMarkdown() {
    const diffs = computeEditsSummary();
    const lines = ["### Правки и ведомость розеток / RJ-45"];
    if (diffs.length) {
      lines.push("", "**Изменения относительно базового плана:**");
      diffs.forEach((d) => lines.push(`- ${d}`));
    } else {
      lines.push("", "_Изменений относительно базовой схемы розеток v=12 пока нет._");
    }
    lines.push("", "**Сводка по группам щита ЩР:**");
    state.groups.forEach((g) => {
      const t = getGroupTotals(g.id);
      lines.push(`- **${g.code}** (${g.name}, ${g.breaker}): ${t.socketsCount} роз. 230В, ${t.rj45Count} RJ-45, **${t.watts} Вт** (${t.amps.toFixed(1)} А)`);
    });
    return lines.join("\n");
  }

  /* ==================== RENDER ENGINE ==================== */

  function renderPlanOverlays() {
    // Mask stray marks from scanned PNG
    wallGuidesEl.innerHTML = "";
    [
      { x: 490, y: 1849, w: 48, h: 52 },
      { x: 842, y: 1664, w: 62, h: 46 },
      { x: 862, y: 2091, w: 60, h: 46 }
    ].forEach((m) => {
      wallGuidesEl.appendChild(createSvgEl("rect", { x: m.x, y: m.y, width: m.w, height: m.h, fill: "#ffffff" }));
    });

    // Subtle highlighted clickable wall guides when dragging or selecting
    DATA.wallSegments.forEach((w) => {
      wallGuidesEl.appendChild(
        createSvgEl("line", {
          x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2,
          stroke: "#94a3b8", "stroke-width": 2, "stroke-opacity": 0.28, "stroke-dasharray": "6 6"
        })
      );
    });

    // Power & Cat6 lines from ЩР / Wi-Fi for active groups or selected block
    powerWiresEl.innerHTML = "";
    const sel = state.selectedBlockId ? getBlockById(state.selectedBlockId) : null;
    state.blocks.forEach((b) => {
      if (b.kind === "shield") return;
      const isGrpActive = !!state.activeGroups[b.groupId];
      const isSel = sel && (sel.id === b.id || sel.groupId === b.groupId);
      if (!isGrpActive && !isSel) return;
      const grp = getGroupById(b.groupId);
      const col = grp ? grp.color : "#2563eb";
      const ax = b.kind === "rj45" && !b.sockets ? DATA.wifiAnchor.x : DATA.shieldAnchor.x;
      const ay = b.kind === "rj45" && !b.sockets ? DATA.wifiAnchor.y : DATA.shieldAnchor.y;
      powerWiresEl.appendChild(
        createSvgEl("line", {
          x1: ax, y1: ay, x2: b.x, y2: b.y,
          stroke: b.kind === "rj45" && !b.sockets ? "#16a34a" : col,
          "stroke-width": sel && sel.id === b.id ? 4.2 : 2.6,
          "stroke-opacity": sel && sel.id === b.id ? 0.85 : 0.45,
          "stroke-dasharray": "10 7",
          "stroke-linecap": "round"
        })
      );
      if (b.sockets > 0 && b.rj45 > 0) {
        powerWiresEl.appendChild(
          createSvgEl("line", {
            x1: DATA.wifiAnchor.x, y1: DATA.wifiAnchor.y, x2: b.x, y2: b.y,
            stroke: "#16a34a", "stroke-width": 2.8, "stroke-opacity": 0.65, "stroke-dasharray": "5 5"
          })
        );
      }
    });

    // Wall offset dimension lines (show for selected/hovered block, plus compact h-labels if showDims is true)
    dimsLayerEl.innerHTML = "";
    const focusId = state.hoveredBlockId || state.selectedBlockId;
    state.blocks.forEach((b) => {
      const isFocused = b.id === focusId;
      if (!isFocused && !state.showDims) return;
      if (!b.wallId) return;
      const wall = wallById.get(b.wallId);
      if (!wall) return;

      if (isFocused) {
        const { origin, isHorizontal } = getWallEndpoints(wall, b.refSide === "right" ? "right" : "left");
        const offN = wall.normal === "left" ? -34 : wall.normal === "right" ? 34 : wall.normal === "up" ? -34 : 34;
        const dx = isHorizontal ? 0 : offN;
        const dy = isHorizontal ? offN : 0;
        const ox = origin.x + dx;
        const oy = origin.y + dy;
        const bx = b.x + dx;
        const by = b.y + dy;
        // Extension lines
        dimsLayerEl.appendChild(createSvgEl("line", { x1: origin.x, y1: origin.y, x2: ox, y2: oy, stroke: "#2563eb", "stroke-width": 1.6, "stroke-opacity": 0.7 }));
        dimsLayerEl.appendChild(createSvgEl("line", { x1: b.x, y1: b.y, x2: bx, y2: by, stroke: "#2563eb", "stroke-width": 1.6, "stroke-opacity": 0.7 }));
        // Dim line
        dimsLayerEl.appendChild(createSvgEl("line", { x1: ox, y1: oy, x2: bx, y2: by, stroke: "#1d4ed8", "stroke-width": 2.4 }));
        dimsLayerEl.appendChild(createSvgEl("circle", { cx: ox, cy: oy, r: 4, fill: "#1d4ed8" }));
        dimsLayerEl.appendChild(createSvgEl("circle", { cx: bx, cy: by, r: 4, fill: "#1d4ed8" }));
        const mx = (ox + bx) / 2;
        const my = (oy + by) / 2;
        const lbl = `${b.offsetMm} мм (${b.refSide === "right" ? "прав." : "лев."}) · h=${b.heightMm}`;
        const pw = Math.max(120, lbl.length * 9.2);
        dimsLayerEl.appendChild(createSvgEl("rect", { x: mx - pw / 2, y: my - 13, width: pw, height: 24, rx: 6, fill: "#1e3a8a", stroke: "#93c5fd", "stroke-width": 1.5 }));
        const txt = createSvgEl("text", { x: mx, y: my + 3.5, "text-anchor": "middle", fill: "#ffffff", "font-size": "13.5", "font-weight": "800" });
        txt.textContent = lbl;
        dimsLayerEl.appendChild(txt);
      }
    });
  }

  function renderSocketMarkers() {
    socketsLayerEl.innerHTML = "";
    state.blocks.forEach((b) => {
      const grp = getGroupById(b.groupId);
      const isSelected = state.selectedBlockId === b.id;
      const isGrpOn = !!state.activeGroups[b.groupId];
      const wall = b.wallId ? wallById.get(b.wallId) : null;
      const isVertWall = wall && Math.abs(wall.y2 - wall.y1) > Math.abs(wall.x2 - wall.x1);

      const el = document.createElement("div");
      el.className = "socket-marker";
      if (isSelected) el.classList.add("is-selected");
      if (isGrpOn) el.classList.add("is-group-on");
      el.style.left = `${b.x}px`;
      el.style.top = `${b.y}px`;
      el.dataset.blockId = b.id;

      const frame = document.createElement("div");
      frame.className = "sock-frame";
      if (isVertWall && (b.sockets + b.rj45) > 1) frame.classList.add("is-vertical");
      if (b.ip44) frame.classList.add("is-ip44");
      if (b.kind === "rj45" || (b.sockets === 0 && b.rj45 > 0)) frame.classList.add("is-rj45-only");
      if (b.kind === "power") frame.classList.add("is-power");
      if (b.kind === "cable") frame.classList.add("is-cable");
      if (b.kind === "thermo") frame.classList.add("is-thermo");
      if (b.kind === "shield") frame.classList.add("is-shield");

      if (grp && !b.ip44 && b.kind === "socket" && b.sockets > 0 && !isGrpOn) {
        frame.style.borderColor = grp.color;
      }

      if (b.kind === "power") {
        frame.innerHTML = `<span class="sock-special-lbl">⚡ 3×6,0</span>`;
      } else if (b.kind === "cable") {
        frame.innerHTML = `<span class="sock-special-lbl">🟠 Вывод</span>`;
      } else if (b.kind === "thermo") {
        frame.innerHTML = `<span class="sock-special-lbl">☒ ТП</span>`;
      } else if (b.kind === "shield") {
        frame.innerHTML = `<span class="sock-special-lbl">ЩР + Wi-Fi</span>`;
      } else {
        for (let i = 0; i < (b.sockets || 0); i++) {
          const well = document.createElement("span");
          well.className = "sock-well";
          well.innerHTML = `<span class="sock-pin"></span><span class="sock-pin"></span>`;
          frame.appendChild(well);
        }
        for (let j = 0; j < (b.rj45 || 0); j++) {
          const port = document.createElement("span");
          port.className = "sock-rj45-port";
          port.textContent = "@";
          frame.appendChild(port);
        }
        if ((b.sockets || 0) === 0 && (b.rj45 || 0) === 0) {
          frame.innerHTML = `<span class="sock-special-lbl">Пусто</span>`;
        }
      }
      el.appendChild(frame);

      if (state.showDims || isSelected) {
        const tag = document.createElement("div");
        tag.className = "sock-tag-pill";
        const gCode = grp ? grp.code.replace("Гр. ", "Г") : "";
        const offStr = wall ? `${b.offsetMm}мм ` : "";
        tag.textContent = b.kind === "shield" ? "ЩР h=1700" : `${gCode ? gCode + " · " : ""}${offStr}h=${b.heightMm}`;
        el.appendChild(tag);
      }

      bindBlockMarkerEvents(el, b);
      socketsLayerEl.appendChild(el);
    });
  }

  function renderStatsAndBadges() {
    const totalSockets = state.blocks.reduce((s, b) => s + (Number(b.sockets) || 0), 0);
    const totalRj45 = state.blocks.reduce((s, b) => s + (Number(b.rj45) || 0), 0);
    const activeWatts = state.blocks
      .filter((b) => state.activeGroups[b.groupId])
      .reduce((s, b) => s + (Number(b.watts) || 0), 0);
    statSocketsEl.textContent = String(totalSockets);
    statRj45El.textContent = String(totalRj45);
    statWattsEl.textContent = `${activeWatts.toLocaleString("ru-RU")} Вт`;
    tabBlocksCountEl.textContent = String(state.blocks.length);

    const diffCount = computeEditsSummary().length;
    editsBtnCountEl.textContent = String(diffCount);
    editsTabCountEl.textContent = String(diffCount);
  }

  function renderInspector() {
    const b = state.selectedBlockId ? getBlockById(state.selectedBlockId) : null;
    if (!b) {
      inspectorEl.innerHTML = `
        <div class="inspector-empty">
          <strong>Нажмите на любую розетку, RJ-45 или вывод на плане</strong>, чтобы:<br>
          • выбрать число постов <strong>1 / 2 / 3 / 4 / 5 розеток</strong> и добавить <strong>интернет RJ-45</strong>;<br>
          • задать <strong>высоту от пола (h, мм)</strong> и <strong>отступ от левой или правой стены (мм)</strong>;<br>
          • сменить <strong>группу в щите ЩР</strong> или удалить/добавить точку.<br>
          <span style="color:#2563eb;font-weight:700;">💡 Можно просто перетаскивать блоки прямо по стенам мышью или пальцем!</span>
        </div>`;
      return;
    }

    const wall = b.wallId ? wallById.get(b.wallId) : null;
    const isLeftSide = b.refSide !== "right";
    const groupOpts = state.groups
      .map((g) => `<option value="${escapeHtml(g.id)}" ${g.id === b.groupId ? "selected" : ""}>${escapeHtml(g.code)} — ${escapeHtml(g.name)}</option>`)
      .join("");
    const wallOpts = [
      `<option value="" ${!b.wallId ? "selected" : ""}>Без привязки к стене (свободно)</option>`,
      ...DATA.wallSegments.map((w) => `<option value="${escapeHtml(w.id)}" ${w.id === b.wallId ? "selected" : ""}>${escapeHtml(w.label)}</option>`)
    ].join("");

    const heightPresets = [300, 400, 600, 900, 950, 1050, 1300, 2150, 2450, 2600];

    inspectorEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:6px;">
        <span class="mini-pill is-blue">${escapeHtml(b.id)} · ${escapeHtml(b.room)}</span>
        <div style="display:flex;gap:4px;">
          <button type="button" class="step-btn" id="ins-dup-btn" title="Дублировать точку рядом">📋 Копия</button>
          <button type="button" class="btn-danger-outline" id="ins-del-btn" style="padding:4px 8px;font-size:11px;">🗑️ Удалить</button>
        </div>
      </div>

      <input type="text" id="ins-title" class="text-input" value="${escapeHtml(b.title)}" placeholder="Название точки">

      <div class="ed-section">
        <span class="ed-label">Количество розеток 230 В (постов в рамке)</span>
        <div class="seg-row">
          ${[0, 1, 2, 3, 4, 5]
            .map(
              (cnt) =>
                `<button type="button" class="seg-btn ${b.sockets === cnt && (b.kind === "socket" || b.kind === "rj45") ? "is-active" : ""}" data-set-sockets="${cnt}">${cnt === 0 ? "0" : cnt + "×"}</button>`
            )
            .join("")}
        </div>
        <span class="ed-label" style="margin-top:7px;">Интернет-розетка RJ-45 (Cat 6) и влагозащита</span>
        <div class="seg-row">
          ${[0, 1, 2]
            .map(
              (rj) =>
                `<button type="button" class="seg-btn is-green ${b.rj45 === rj ? "is-active" : ""}" data-set-rj45="${rj}">${rj === 0 ? "Без RJ-45" : `+${rj} RJ-45`}</button>`
            )
            .join("")}
          <button type="button" class="seg-btn is-cyan ${b.ip44 ? "is-active" : ""}" id="ins-toggle-ip44">${b.ip44 ? "✓ IP44+" : "IP44+"}</button>
        </div>
        <div class="seg-row" style="margin-top:6px;">
          ${[
            ["socket", "Розетка"],
            ["power", "Силовой 3×6"],
            ["cable", "Вывод (без роз.)"],
            ["thermo", "ТП [☒]"]
          ]
            .map(
              ([kd, lbl]) =>
                `<button type="button" class="seg-btn ${b.kind === kd ? "is-active" : ""}" data-set-kind="${kd}" style="font-size:10.5px;">${lbl}</button>`
            )
            .join("")}
        </div>
      </div>

      <div class="ed-section">
        <span class="ed-label">Высота от пола h (мм)</span>
        <div class="num-row">
          <button type="button" class="step-btn" data-h-step="-100">−100</button>
          <button type="button" class="step-btn" data-h-step="-50">−50</button>
          <input type="number" id="ins-height-mm" class="num-input" value="${b.heightMm}" min="0" max="3200" step="10">
          <button type="button" class="step-btn" data-h-step="50">+50</button>
          <button type="button" class="step-btn" data-h-step="100">+100</button>
        </div>
        <div class="preset-chips">
          ${heightPresets
            .map((hp) => `<button type="button" class="preset-chip ${Number(b.heightMm) === hp ? "is-active" : ""}" data-h-preset="${hp}">h=${hp}</button>`)
            .join("")}
        </div>
      </div>

      <div class="ed-section">
        <span class="ed-label">Отступ от стены (правой или левой, мм)</span>
        <select id="ins-wall-select" class="select-input" style="margin-bottom:6px;">${wallOpts}</select>
        ${
          wall
            ? `
          <div class="seg-row">
            <button type="button" class="seg-btn ${isLeftSide ? "is-active" : ""}" data-ref-side="left">⬅ От левой стены</button>
            <button type="button" class="seg-btn ${!isLeftSide ? "is-active" : ""}" data-ref-side="right">От правой стены ➡</button>
          </div>
          <div class="num-row">
            <button type="button" class="step-btn" data-off-step="-100">−100</button>
            <button type="button" class="step-btn" data-off-step="-10">−10</button>
            <input type="number" id="ins-offset-mm" class="num-input" value="${b.offsetMm}" min="0" max="${wall.lengthMm}" step="10">
            <button type="button" class="step-btn" data-off-step="10">+10</button>
            <button type="button" class="step-btn" data-off-step="100">+100</button>
          </div>
          <div style="font-size:10.5px;color:#64748b;margin-top:4px;">
            До противоположного края стены: <b>${Math.max(0, wall.lengthMm - b.offsetMm)} мм</b> (вся стена ${wall.lengthMm} мм)
          </div>`
            : `<div style="font-size:11px;color:#64748b;">Перетащите на любую стену или выберите стену выше для привязки в мм.</div>`
        }
        <label style="display:flex;align-items:center;gap:6px;font-size:11px;margin-top:6px;cursor:pointer;">
          <input type="checkbox" id="ins-pencil-chk" ${b.byPencil ? "checked" : ""}>
          <span>✏️ Сверлить по карандашной метке на стене</span>
        </label>
      </div>

      <div class="ed-section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span class="ed-label" style="margin:0;">Группа в щите ЩР</span>
          <button type="button" class="preset-chip" id="ins-new-grp-btn">+ Новая группа</button>
        </div>
        <select id="ins-group-select" class="select-input">${groupOpts}</select>
        <div class="num-row" style="margin-top:6px;">
          <span style="font-size:11px;font-weight:700;color:#475569;">Мощность (Вт):</span>
          <input type="number" id="ins-watts" class="num-input" value="${b.watts || 0}" min="0" max="10000" step="10">
        </div>
        <input type="text" id="ins-comment" class="text-input" style="margin-top:6px;" value="${escapeHtml(b.comment || "")}" placeholder="Комментарий / устройства в блоке">
      </div>
    `;

    // Bind inspector handlers cleanly
    document.getElementById("ins-title").addEventListener("change", (e) => {
      b.title = e.target.value.trim() || b.title;
      saveToStorage();
      renderSidebarTab();
      renderStatsAndBadges();
    });
    document.getElementById("ins-del-btn").addEventListener("click", () => {
      state.blocks = state.blocks.filter((x) => x.id !== b.id);
      state.selectedBlockId = null;
      saveToStorage();
      renderAll();
    });
    document.getElementById("ins-dup-btn").addEventListener("click", () => {
      duplicateBlock(b);
    });
    inspectorEl.querySelectorAll("[data-set-sockets]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cnt = Number(btn.getAttribute("data-set-sockets"));
        b.sockets = cnt;
        if (cnt > 0) b.kind = "socket";
        else if (b.rj45 > 0) b.kind = "rj45";
        else {
          b.rj45 = 1;
          b.kind = "rj45";
        }
        saveToStorage();
        renderAll();
      });
    });
    inspectorEl.querySelectorAll("[data-set-rj45]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const rj = Number(btn.getAttribute("data-set-rj45"));
        b.rj45 = rj;
        if (b.sockets === 0 && rj > 0) b.kind = "rj45";
        else if (b.sockets === 0 && rj === 0) {
          b.sockets = 1;
          b.kind = "socket";
        }
        saveToStorage();
        renderAll();
      });
    });
    document.getElementById("ins-toggle-ip44").addEventListener("click", () => {
      b.ip44 = !b.ip44;
      saveToStorage();
      renderAll();
    });
    inspectorEl.querySelectorAll("[data-set-kind]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const kd = btn.getAttribute("data-set-kind");
        b.kind = kd;
        if (kd === "socket" && b.sockets === 0) b.sockets = 1;
        if (kd !== "socket" && kd !== "rj45") {
          b.sockets = 0;
          b.rj45 = 0;
        }
        saveToStorage();
        renderAll();
      });
    });

    const hInput = document.getElementById("ins-height-mm");
    hInput.addEventListener("input", () => {
      const val = parseInt(hInput.value, 10);
      if (!Number.isNaN(val)) {
        b.heightMm = Math.max(0, Math.min(3200, val));
        renderPlanOverlays();
        renderSocketMarkers();
        renderSidebarTab();
        renderStatsAndBadges();
      }
    });
    hInput.addEventListener("change", () => {
      b.heightMm = Math.max(0, Math.min(3200, Math.round(Number(hInput.value) || 0)));
      saveToStorage();
      renderAll();
    });
    inspectorEl.querySelectorAll("[data-h-step]").forEach((btn) => {
      btn.addEventListener("click", () => {
        b.heightMm = Math.max(0, Math.min(3200, (Number(b.heightMm) || 0) + Number(btn.getAttribute("data-h-step"))));
        saveToStorage();
        renderAll();
      });
    });
    inspectorEl.querySelectorAll("[data-h-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        b.heightMm = Number(btn.getAttribute("data-h-preset"));
        saveToStorage();
        renderAll();
      });
    });

    document.getElementById("ins-wall-select").addEventListener("change", (e) => {
      const wid = e.target.value;
      if (!wid) {
        b.wallId = "";
        saveToStorage();
        renderAll();
        return;
      }
      const nextWall = wallById.get(wid);
      if (nextWall) {
        moveBlockToWallOffset(b, nextWall, b.refSide || "left", Math.round(nextWall.lengthMm / 2));
        saveToStorage();
        renderAll();
      }
    });

    if (wall) {
      inspectorEl.querySelectorAll("[data-ref-side]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const newSide = btn.getAttribute("data-ref-side");
          if (newSide !== b.refSide) {
            b.refSide = newSide;
            b.offsetMm = Math.max(0, wall.lengthMm - (Number(b.offsetMm) || 0));
            saveToStorage();
            renderAll();
          }
        });
      });
      const offInput = document.getElementById("ins-offset-mm");
      offInput.addEventListener("input", () => {
        const val = parseInt(offInput.value, 10);
        if (!Number.isNaN(val)) {
          moveBlockToWallOffset(b, wall, b.refSide || "left", val);
          renderPlanOverlays();
          renderSocketMarkers();
          renderSidebarTab();
          renderStatsAndBadges();
        }
      });
      offInput.addEventListener("change", () => {
        moveBlockToWallOffset(b, wall, b.refSide || "left", Number(offInput.value));
        saveToStorage();
        renderAll();
      });
      inspectorEl.querySelectorAll("[data-off-step]").forEach((btn) => {
        btn.addEventListener("click", () => {
          moveBlockToWallOffset(b, wall, b.refSide || "left", (Number(b.offsetMm) || 0) + Number(btn.getAttribute("data-off-step")));
          saveToStorage();
          renderAll();
        });
      });
    }

    document.getElementById("ins-pencil-chk").addEventListener("change", (e) => {
      b.byPencil = !!e.target.checked;
      saveToStorage();
      renderSidebarTab();
      renderStatsAndBadges();
    });
    document.getElementById("ins-group-select").addEventListener("change", (e) => {
      b.groupId = e.target.value;
      state.activeGroups[b.groupId] = true;
      saveToStorage();
      renderAll();
    });
    document.getElementById("ins-new-grp-btn").addEventListener("click", () => {
      openAddGroupModal(b.id);
    });
    document.getElementById("ins-watts").addEventListener("input", (e) => {
      const val = parseInt(e.target.value, 10);
      if (!Number.isNaN(val)) {
        b.watts = Math.max(0, val);
        renderSidebarTab();
        renderStatsAndBadges();
      }
    });
    document.getElementById("ins-watts").addEventListener("change", (e) => {
      b.watts = Math.max(0, Math.round(Number(e.target.value) || 0));
      saveToStorage();
      renderAll();
    });
    document.getElementById("ins-comment").addEventListener("change", (e) => {
      b.comment = e.target.value;
      saveToStorage();
      renderStatsAndBadges();
    });
  }

  function renderSidebarTab() {
    if (state.activeTab === "blocks") {
      const grouped = new Map();
      state.blocks.forEach((b) => {
        const rm = b.room || "Прочее";
        if (!grouped.has(rm)) grouped.set(rm, []);
        grouped.get(rm).push(b);
      });
      const html = Array.from(grouped.entries())
        .map(([rm, list]) => {
          const rmWatts = list.reduce((s, x) => s + (Number(x.watts) || 0), 0);
          const rmSocks = list.reduce((s, x) => s + (Number(x.sockets) || 0), 0);
          const itemsHtml = list
            .map((b) => {
              const grp = getGroupById(b.groupId);
              const isSel = state.selectedBlockId === b.id;
              const sideTxt = b.wallId ? `${b.offsetMm} мм (${b.refSide === "right" ? "прав." : "лев."})` : "свободно";
              return `
                <div class="block-item ${isSel ? "is-selected" : ""}" data-select-block="${escapeHtml(b.id)}">
                  <div class="block-item-top">
                    <span>${escapeHtml(b.title)}</span>
                    <button type="button" class="step-btn" data-quick-del="${escapeHtml(b.id)}" style="padding:1px 6px;color:#dc2626;" title="Удалить">×</button>
                  </div>
                  <div class="block-badges">
                    <span class="mini-pill ${b.ip44 ? "is-cyan" : "is-red"}">${escapeHtml(formatBlockTypeSummary(b))}</span>
                    ${grp ? `<span class="mini-pill is-blue">${escapeHtml(grp.code)}</span>` : ""}
                    <span class="mini-pill">h=${b.heightMm}</span>
                    <span class="mini-pill">${escapeHtml(sideTxt)}</span>
                    ${b.watts ? `<span class="mini-pill is-green">${b.watts} Вт</span>` : ""}
                  </div>
                </div>`;
            })
            .join("");
          return `<div class="room-group"><div class="room-group-hdr"><span>${escapeHtml(rm)}</span><span>${rmSocks} роз. · ${rmWatts} Вт</span></div>${itemsHtml}</div>`;
        })
        .join("");
      tabContentEl.innerHTML = html || "<div class='inspector-empty'>Нет точек розеток.</div>";

      tabContentEl.querySelectorAll("[data-select-block]").forEach((el) => {
        el.addEventListener("click", (e) => {
          if (e.target.closest("[data-quick-del]")) return;
          selectBlock(el.getAttribute("data-select-block"), true);
        });
      });
      tabContentEl.querySelectorAll("[data-quick-del]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = btn.getAttribute("data-quick-del");
          state.blocks = state.blocks.filter((x) => x.id !== id);
          if (state.selectedBlockId === id) state.selectedBlockId = null;
          saveToStorage();
          renderAll();
        });
      });
      return;
    }

    if (state.activeTab === "groups") {
      const topBtn = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:11.5px;color:#475569;font-weight:700;">Нажмите на группу, чтобы подсветить её розетки и кабель от ЩР:</span>
        <button type="button" class="btn-primary" id="btn-tab-add-grp" style="padding:4px 8px;font-size:11px;">+ Группа</button>
      </div>`;
      const cardsHtml = state.groups
        .map((g) => {
          const t = getGroupTotals(g.id);
          const isOn = !!state.activeGroups[g.id];
          return `
            <div class="shield-card ${isOn ? "is-on" : ""} ${t.overload ? "is-overload" : ""}" data-toggle-grp="${escapeHtml(g.id)}" style="cursor:pointer;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
                <span style="font-weight:800;font-size:12.5px;color:#0f172a;">
                  <span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${escapeHtml(g.color)};margin-right:4px;"></span>
                  ${escapeHtml(g.code)} · ${escapeHtml(g.breaker)}
                </span>
                <span class="mini-pill ${t.overload ? "is-red" : isOn ? "is-green" : ""}">${isOn ? "✓ Подсвечено" : "Показать"}</span>
              </div>
              <div style="font-size:11.5px;color:#334155;margin-top:3px;">${escapeHtml(g.name)}</div>
              <div class="shield-bar"><div class="shield-bar-fill" style="width:${t.pct}%;background:${t.overload ? "#dc2626" : g.color};"></div></div>
              <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700;color:${t.overload ? "#b91c1c" : "#1e3a8a"};">
                <span>${t.socketsCount} роз. · ${t.rj45Count} RJ-45 (${escapeHtml(g.cable)})</span>
                <span>${t.watts.toLocaleString("ru-RU")} / ${t.maxWatts.toLocaleString("ru-RU")} Вт (${t.amps.toFixed(1)} А)</span>
              </div>
            </div>`;
        })
        .join("");
      tabContentEl.innerHTML = topBtn + cardsHtml;
      document.getElementById("btn-tab-add-grp").addEventListener("click", () => openAddGroupModal(null));
      tabContentEl.querySelectorAll("[data-toggle-grp]").forEach((card) => {
        card.addEventListener("click", () => {
          const gid = card.getAttribute("data-toggle-grp");
          state.activeGroups[gid] = !state.activeGroups[gid];
          saveToStorage();
          renderAll();
        });
      });
      return;
    }

    // Edits tab
    const diffs = computeEditsSummary();
    tabContentEl.innerHTML = diffs.length
      ? diffs.map((d) => `<div class="block-item" style="font-size:11.5px;">• ${escapeHtml(d)}</div>`).join("")
      : `<div class="inspector-empty">Изменений относительно базовой схемы v=12 пока нет. Любая перестановка, добавление 1–5 розеток, RJ-45, смена группы или высоты/отступа появится здесь.</div>`;
  }

  function renderAll() {
    renderPlanOverlays();
    renderSocketMarkers();
    renderInspector();
    renderSidebarTab();
    renderStatsAndBadges();
  }

  /* ==================== ACTIONS & MODALS ==================== */

  function selectBlock(id, panIntoView) {
    state.selectedBlockId = id;
    const b = getBlockById(id);
    if (b) {
      state.activeGroups[b.groupId] = true;
      if (panIntoView) panToPointIfNeeded(b.x, b.y);
    }
    renderAll();
  }

  function getNextBlockId() {
    let n = state.blocks.length + 1;
    while (getBlockById(`R${n}`)) n += 1;
    return `R${n}`;
  }

  function duplicateBlock(src) {
    const wall = src.wallId ? wallById.get(src.wallId) : null;
    const copy = deepClone(src);
    copy.id = getNextBlockId();
    copy.title = `${src.title} (копия)`;
    if (wall) {
      const nextOff = src.offsetMm + 250 <= wall.lengthMm ? src.offsetMm + 250 : Math.max(0, src.offsetMm - 250);
      moveBlockToWallOffset(copy, wall, src.refSide || "left", nextOff);
    } else {
      copy.x += 55;
      copy.y += 55;
    }
    state.blocks.push(copy);
    state.selectedBlockId = copy.id;
    saveToStorage();
    renderAll();
  }

  function openModal(html) {
    modalBoxEl.innerHTML = html;
    modalBackdropEl.classList.remove("is-hidden");
  }

  function closeModal() {
    modalBackdropEl.classList.add("is-hidden");
    modalBoxEl.innerHTML = "";
  }

  function openAddSocketModal() {
    const wallOpts = DATA.wallSegments
      .map((w) => `<option value="${escapeHtml(w.id)}" ${w.id === "liv_right" ? "selected" : ""}>${escapeHtml(w.label)}</option>`)
      .join("");
    const grpOpts = state.groups
      .map((g) => `<option value="${escapeHtml(g.id)}" ${g.id === "G12" ? "selected" : ""}>${escapeHtml(g.code)} — ${escapeHtml(g.name)}</option>`)
      .join("");

    let chosenSockets = 2;
    let chosenRj45 = 0;
    let chosenIp44 = false;

    openModal(`
      <h3>+ Добавить розетку / интернет-блок RJ-45</h3>
      <div class="ed-section">
        <span class="ed-label">Сколько розеток 230 В в рамке</span>
        <div class="seg-row" id="add-sock-seg">
          ${[0, 1, 2, 3, 4, 5].map((c) => `<button type="button" class="seg-btn ${c === 2 ? "is-active" : ""}" data-add-sock="${c}">${c === 0 ? "0 (нет)" : `${c} роз.`}</button>`).join("")}
        </div>
        <span class="ed-label" style="margin-top:8px;">Добавить интернет-розетку RJ-45</span>
        <div class="seg-row" id="add-rj-seg">
          ${[0, 1, 2].map((r) => `<button type="button" class="seg-btn is-green ${r === 0 ? "is-active" : ""}" data-add-rj="${r}">${r === 0 ? "Нет" : `+${r} RJ-45`}</button>`).join("")}
          <button type="button" class="seg-btn is-cyan" id="add-ip44-btn">IP44+</button>
        </div>
      </div>
      <div class="ed-section">
        <span class="ed-label">Стена, высота от пола h и отступ от угла (мм)</span>
        <select id="add-wall" class="select-input" style="margin-bottom:6px;">${wallOpts}</select>
        <div class="seg-row" style="margin-bottom:6px;">
          <select id="add-ref-side" class="select-input" style="flex:1;">
            <option value="left">⬅ От левой стены</option>
            <option value="right">От правой стены ➡</option>
          </select>
          <input type="number" id="add-offset-mm" class="num-input" value="500" step="10" style="flex:1;" placeholder="Отступ мм">
          <input type="number" id="add-height-mm" class="num-input" value="300" step="10" style="flex:1;" placeholder="Высота h">
        </div>
        <span class="ed-label">Группа щита ЩР, мощность (Вт) и подпись</span>
        <select id="add-group" class="select-input" style="margin-bottom:6px;">${grpOpts}</select>
        <div class="seg-row">
          <input type="text" id="add-title" class="text-input" value="Новый розеточный блок" style="flex:2;">
          <input type="number" id="add-watts" class="num-input" value="200" step="10" style="flex:1;">
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="modal-cancel">Отмена</button>
        <button type="button" class="btn-primary" id="modal-confirm-add">Добавить на план</button>
      </div>
    `);

    modalBoxEl.querySelectorAll("[data-add-sock]").forEach((btn) => {
      btn.addEventListener("click", () => {
        chosenSockets = Number(btn.getAttribute("data-add-sock"));
        modalBoxEl.querySelectorAll("[data-add-sock]").forEach((x) => x.classList.toggle("is-active", x === btn));
      });
    });
    modalBoxEl.querySelectorAll("[data-add-rj]").forEach((btn) => {
      btn.addEventListener("click", () => {
        chosenRj45 = Number(btn.getAttribute("data-add-rj"));
        modalBoxEl.querySelectorAll("[data-add-rj]").forEach((x) => x.classList.toggle("is-active", x === btn));
      });
    });
    document.getElementById("add-ip44-btn").addEventListener("click", (e) => {
      chosenIp44 = !chosenIp44;
      e.target.classList.toggle("is-active", chosenIp44);
    });
    document.getElementById("modal-cancel").addEventListener("click", closeModal);
    document.getElementById("modal-confirm-add").addEventListener("click", () => {
      const wid = document.getElementById("add-wall").value;
      const wall = wallById.get(wid) || DATA.wallSegments[0];
      const refSide = document.getElementById("add-ref-side").value;
      const offMm = Number(document.getElementById("add-offset-mm").value) || 500;
      const hMm = Math.max(0, Math.round(Number(document.getElementById("add-height-mm").value) || 300));
      const gid = document.getElementById("add-group").value;
      const title = document.getElementById("add-title").value.trim() || "Новый блок";
      const watts = Math.max(0, Math.round(Number(document.getElementById("add-watts").value) || 0));
      if (chosenSockets === 0 && chosenRj45 === 0) chosenRj45 = 1;

      const newBlock = {
        id: getNextBlockId(),
        room: wall.room,
        title,
        kind: chosenSockets === 0 && chosenRj45 > 0 ? "rj45" : "socket",
        sockets: chosenSockets,
        rj45: chosenRj45,
        ip44: chosenIp44,
        watts,
        groupId: gid,
        wallId: wall.id,
        refSide,
        offsetMm: offMm,
        heightMm: hMm,
        byPencil: false,
        x: wall.x1,
        y: wall.y1,
        comment: ""
      };
      moveBlockToWallOffset(newBlock, wall, refSide, offMm);
      state.blocks.push(newBlock);
      state.activeGroups[gid] = true;
      closeModal();
      saveToStorage();
      selectBlock(newBlock.id, true);
    });
  }

  function openAddGroupModal(assignToBlockId) {
    let nextNum = state.groups.length + 2;
    while (state.groups.some((g) => g.id === `G${nextNum}`)) nextNum += 1;
    const defCode = `Гр. ${String(nextNum).padStart(2, "0")}`;
    openModal(`
      <h3>+ Новая группа электрощита ЩР</h3>
      <div class="ed-section">
        <span class="ed-label">Номер линии в щите</span>
        <input type="text" id="ng-code" class="text-input" value="${defCode}" style="margin-bottom:6px;">
        <span class="ed-label">Назначение (помещение / приборы)</span>
        <input type="text" id="ng-name" class="text-input" value="Доп. линия розеток зала" style="margin-bottom:6px;">
        <span class="ed-label">Автомат и лимит мощности (Вт)</span>
        <div class="seg-row">
          <select id="ng-breaker" class="select-input" style="flex:1;">
            <option value="C16 (УЗО А 30 мА)|3680|ВВГ 3×2,5">C16 (3 680 Вт, 3×2,5)</option>
            <option value="C20 (УЗО А 30 мА)|4600|ВВГ 3×4,0">C20 (4 600 Вт, 3×4,0)</option>
            <option value="C32 (дифавтомат)|7360|ВВГ 3×6,0">C32 (7 360 Вт, 3×6,0)</option>
          </select>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="modal-cancel">Отмена</button>
        <button type="button" class="btn-primary" id="modal-confirm-grp">Создать группу</button>
      </div>
    `);
    document.getElementById("modal-cancel").addEventListener("click", closeModal);
    document.getElementById("modal-confirm-grp").addEventListener("click", () => {
      const code = document.getElementById("ng-code").value.trim() || defCode;
      const name = document.getElementById("ng-name").value.trim() || "Дополнительная линия";
      const [breaker, maxWStr, cable] = document.getElementById("ng-breaker").value.split("|");
      const palette = ["#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6"];
      const newGrp = {
        id: `G${nextNum}`,
        code,
        name,
        breaker,
        maxWatts: Number(maxWStr) || 3680,
        cable,
        color: palette[state.groups.length % palette.length],
        nonMaster: true
      };
      state.groups.push(newGrp);
      state.activeGroups[newGrp.id] = true;
      if (assignToBlockId) {
        const blk = getBlockById(assignToBlockId);
        if (blk) blk.groupId = newGrp.id;
      }
      closeModal();
      saveToStorage();
      renderAll();
    });
  }

  function openExportModal() {
    const md = buildExportMarkdown();
    openModal(`
      <h3>📋 Правки и ведомость розеток (Markdown)</h3>
      <textarea id="export-md-ta" class="text-input" style="height:260px;font-family:monospace;font-size:11.5px;">${escapeHtml(md)}</textarea>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="modal-cancel">Закрыть</button>
        <button type="button" class="btn-primary" id="modal-copy-btn">Скопировать текст</button>
      </div>
    `);
    document.getElementById("modal-cancel").addEventListener("click", closeModal);
    document.getElementById("modal-copy-btn").addEventListener("click", () => {
      const ta = document.getElementById("export-md-ta");
      ta.select();
      if (navigator.clipboard) navigator.clipboard.writeText(ta.value).catch(() => {});
      else document.execCommand("copy");
      document.getElementById("modal-copy-btn").textContent = "✓ Скопировано!";
    });
  }

  /* ==================== POINTER DRAG, PAN & ZOOM ==================== */

  function bindBlockMarkerEvents(el, b) {
    el.addEventListener("mouseenter", () => {
      state.hoveredBlockId = b.id;
      renderPlanOverlays();
    });
    el.addEventListener("mouseleave", () => {
      if (state.hoveredBlockId === b.id) {
        state.hoveredBlockId = null;
        renderPlanOverlays();
      }
    });
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (suppressNextClick) return;
      selectBlock(b.id, false);
    });
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.isPrimary === false) return;
      e.stopPropagation();
      const pointerId = e.pointerId;
      const downX = e.clientX;
      const downY = e.clientY;
      const origX = b.x;
      const origY = b.y;
      const thresh = e.pointerType === "touch" ? 12 : 5;
      let isDragging = false;

      function onMove(mv) {
        if (mv.pointerId !== pointerId) return;
        const dx = mv.clientX - downX;
        const dy = mv.clientY - downY;
        if (!isDragging && Math.hypot(dx, dy) > thresh) {
          isDragging = true;
          el.classList.add("is-dragging");
          state.selectedBlockId = b.id;
          state.hoveredBlockId = b.id;
        }
        if (isDragging) {
          const rawX = Math.round(Math.max(40, Math.min(DATA.plan.width - 40, origX + dx / state.zoom)));
          const rawY = Math.round(Math.max(40, Math.min(DATA.plan.height - 40, origY + dy / state.zoom)));
          if (!mv.altKey) {
            const snap = findNearestWall(rawX, rawY, 62);
            if (snap) {
              b.wallId = snap.wall.id;
              b.room = snap.wall.room;
              b.x = snap.x;
              b.y = snap.y;
              syncOffsetFromBlockCoords(b);
            } else {
              b.wallId = "";
              b.x = rawX;
              b.y = rawY;
            }
          } else {
            b.wallId = "";
            b.x = rawX;
            b.y = rawY;
          }
          el.style.left = `${b.x}px`;
          el.style.top = `${b.y}px`;
          renderPlanOverlays();
        }
      }

      function onUp(upEv) {
        if (upEv && upEv.pointerId !== undefined && upEv.pointerId !== pointerId) return;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        el.classList.remove("is-dragging");
        if (isDragging) {
          suppressNextClick = true;
          setTimeout(() => { suppressNextClick = false; }, 60);
          saveToStorage();
          renderAll();
        }
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
  }

  function applyTransform() {
    stageEl.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    zoomReadoutEl.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function fitPlanToViewport() {
    const vp = viewportEl.getBoundingClientRect();
    if (!vp.width || !vp.height) return;
    const b = DATA.plan.apartmentBounds;
    const scale = Math.min((vp.width - 56) / (b.maxX - b.minX), (vp.height - 84) / (b.maxY - b.minY));
    state.zoom = Math.max(0.25, Math.min(1.4, scale));
    state.panX = vp.width / 2 - ((b.minX + b.maxX) / 2) * state.zoom;
    state.panY = 24 + (vp.height - 84) / 2 - ((b.minY + b.maxY) / 2) * state.zoom;
    applyTransform();
  }

  function zoomAtPoint(factor, clientX, clientY) {
    const vp = viewportEl.getBoundingClientRect();
    const vx = clientX - vp.left;
    const vy = clientY - vp.top;
    const nextZ = Math.max(0.25, Math.min(2.6, state.zoom * factor));
    const ratio = nextZ / state.zoom;
    state.panX = vx - (vx - state.panX) * ratio;
    state.panY = vy - (vy - state.panY) * ratio;
    state.zoom = nextZ;
    applyTransform();
  }

  function panToPointIfNeeded(px, py) {
    const vp = viewportEl.getBoundingClientRect();
    const sx = px * state.zoom + state.panX;
    const sy = py * state.zoom + state.panY;
    if (sx < 80 || sx > vp.width - 80 || sy < 80 || sy > vp.height - 80) {
      state.panX = vp.width / 2 - px * state.zoom;
      state.panY = vp.height / 2 - py * state.zoom;
      applyTransform();
    }
  }

  viewportEl.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomAtPoint(e.deltaY < 0 ? 1.12 : 0.89, e.clientX, e.clientY);
  }, { passive: false });

  viewportEl.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    if (e.target.closest(".socket-marker, .zoom-controls, .floating-legend")) return;
    const dx0 = e.clientX, dy0 = e.clientY, px0 = state.panX, py0 = state.panY;
    let moved = false;
    viewportEl.classList.add("is-panning");
    function onMove(mv) {
      if (!moved && Math.hypot(mv.clientX - dx0, mv.clientY - dy0) > 4) moved = true;
      if (moved) {
        state.panX = px0 + (mv.clientX - dx0);
        state.panY = py0 + (mv.clientY - dy0);
        applyTransform();
      }
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      viewportEl.classList.remove("is-panning");
      if (!moved) {
        state.selectedBlockId = null;
        renderAll();
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  // Touch pinch/pan support for smartphones
  let touchG = null;
  viewportEl.addEventListener("touchstart", (e) => {
    if (e.target.closest(".zoom-controls, .floating-legend")) return;
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      touchG = { mode: "pinch", dist: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) || 1, cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2 };
    } else if (e.touches.length === 1 && !e.target.closest(".socket-marker")) {
      touchG = { mode: "pan", sx: e.touches[0].clientX, sy: e.touches[0].clientY, px: state.panX, py: state.panY, moved: false };
    }
  }, { passive: true });
  viewportEl.addEventListener("touchmove", (e) => {
    if (!touchG) return;
    if (touchG.mode === "pinch" && e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = e.touches;
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) || 1;
      const cx = (a.clientX + b.clientX) / 2;
      const cy = (a.clientY + b.clientY) / 2;
      state.panX += cx - touchG.cx;
      state.panY += cy - touchG.cy;
      zoomAtPoint(dist / touchG.dist, cx, cy);
      touchG.dist = dist; touchG.cx = cx; touchG.cy = cy;
    } else if (touchG.mode === "pan" && e.touches.length === 1) {
      const t = e.touches[0];
      if (!touchG.moved && Math.hypot(t.clientX - touchG.sx, t.clientY - touchG.sy) > 6) touchG.moved = true;
      if (touchG.moved) {
        e.preventDefault();
        state.panX = touchG.px + (t.clientX - touchG.sx);
        state.panY = touchG.py + (t.clientY - touchG.sy);
        applyTransform();
      }
    }
  }, { passive: false });
  viewportEl.addEventListener("touchend", () => { touchG = null; }, { passive: true });

  // Topbar & Tabs Wireup
  document.getElementById("btn-zoom-in").addEventListener("click", () => {
    const r = viewportEl.getBoundingClientRect();
    zoomAtPoint(1.2, r.left + r.width / 2, r.top + r.height / 2);
  });
  document.getElementById("btn-zoom-out").addEventListener("click", () => {
    const r = viewportEl.getBoundingClientRect();
    zoomAtPoint(0.83, r.left + r.width / 2, r.top + r.height / 2);
  });
  document.getElementById("btn-zoom-fit").addEventListener("click", fitPlanToViewport);
  document.getElementById("btn-add-socket").addEventListener("click", openAddSocketModal);
  document.getElementById("btn-export-edits").addEventListener("click", openExportModal);

  btnToggleDimsEl.addEventListener("click", () => {
    state.showDims = !state.showDims;
    btnToggleDimsEl.classList.toggle("is-active", state.showDims);
    saveToStorage();
    renderAll();
  });

  document.getElementById("btn-all-on").addEventListener("click", () => {
    state.groups.forEach((g) => { state.activeGroups[g.id] = true; });
    saveToStorage();
    renderAll();
  });

  document.getElementById("btn-all-off").addEventListener("click", () => {
    state.activeGroups = {};
    saveToStorage();
    renderAll();
  });

  document.getElementById("btn-reset-edits").addEventListener("click", () => {
    if (!confirm("Сбросить все ваши добавления, перестановки, группы и размеры к базовой схеме розеток?")) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    state.groups = deepClone(BASELINE_GROUPS);
    state.blocks = deepClone(BASELINE_BLOCKS);
    state.activeGroups = { G12: true };
    state.selectedBlockId = null;
    state.showDims = true;
    btnToggleDimsEl.classList.add("is-active");
    renderAll();
  });

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeTab = btn.getAttribute("data-tab");
      document.querySelectorAll(".tab-btn").forEach((b) => {
        const act = b === btn;
        b.classList.toggle("is-active", act);
        b.setAttribute("aria-selected", act ? "true" : "false");
      });
      renderSidebarTab();
    });
  });

  modalBackdropEl.addEventListener("click", (e) => {
    if (e.target === modalBackdropEl) closeModal();
  });

  // Boot
  loadFromStorage();
  btnToggleDimsEl.classList.toggle("is-active", !!state.showDims);
  renderAll();
  requestAnimationFrame(fitPlanToViewport);
  window.addEventListener("load", fitPlanToViewport, { once: true });
  setTimeout(fitPlanToViewport, 80);
  const imgEl = document.getElementById("plan-image");
  if (imgEl && !imgEl.complete) {
    imgEl.addEventListener("load", () => requestAnimationFrame(fitPlanToViewport), { once: true });
  }
})();
