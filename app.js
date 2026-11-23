(function () {
  "use strict";

  const DATA = window.LIGHTING_DATA;
  if (!DATA) {
    console.error("LIGHTING_DATA is not loaded.");
    return;
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  const STORAGE_KEY = "lighting_editor_v8_state";
  const ROOM_ORDER = ["Прихожая", "Кладовая", "Зал", "Кухня", "Балкон", "Санузел", "Спальня"];
  const CIRCUIT_COLORS = ["#facc15", "#fb923c", "#38bdf8"];

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  const BASELINE_SWITCHES = deepClone(DATA.switches);
  const BASELINE_GROUPS = deepClone(DATA.groups);
  const baselineSwitchMap = new Map(BASELINE_SWITCHES.map((s) => [s.id, s]));
  const baselineGroupMap = new Map(BASELINE_GROUPS.map((g) => [g.id, g]));
  const fixturesById = new Map(DATA.fixtures.map((f) => [f.id, f]));

  function buildInitialGroupSettings(groupsList) {
    const map = {};
    groupsList.forEach((g) => {
      map[g.id] = {
        on: false,
        brightness: g.id === "Z-08" || g.id === "BR-03B" ? 90 : 100,
        color: g.id === "Z-08" ? "#ff3b5c" : g.id === "BR-03B" ? "#a855f7" : null,
        scene: null
      };
    });
    return map;
  }

  const state = {
    mode: "normal", // "normal" | "link"
    variant: "A",
    masterLightOn: true,
    masterSwitchDeleted: false,
    groups: deepClone(BASELINE_GROUPS),
    switches: deepClone(BASELINE_SWITCHES),
    groupSettings: buildInitialGroupSettings(BASELINE_GROUPS),
    fixtureComments: {},
    selectedSwitchId: null,
    selectedFixtureId: null,
    hoveredSwitchId: null,
    popoverKind: null, // "switch" | "fixture" | null
    popoverId: null,
    activeTab: "switches",
    demoMode: true,
    showDims: false,
    zoom: 1,
    panX: 0,
    panY: 0
  };

  // DOM references
  const viewportEl = document.getElementById("canvas-viewport");
  const stageEl = document.getElementById("plan-stage");
  const planAdditionsLayerEl = document.getElementById("layer-plan-additions");
  const glowLayerEl = document.getElementById("layer-fixtures-glow");
  const linksLayerEl = document.getElementById("layer-temp-links");
  const dragWireLayerEl = document.getElementById("layer-drag-wire");
  const fixtureHitsLayerEl = document.getElementById("layer-fixture-hits");
  const switchesLayerEl = document.getElementById("layer-switches");
  const popoverEl = document.getElementById("item-popover");
  const inspectorEl = document.getElementById("selected-inspector");
  const tabContentEl = document.getElementById("tab-content");
  const statGroupsEl = document.getElementById("stat-groups");
  const statFixturesEl = document.getElementById("stat-fixtures");
  const zoomReadoutEl = document.getElementById("zoom-readout");
  const btnModeNormal = document.getElementById("btn-mode-normal");
  const btnModeLink = document.getElementById("btn-mode-link");
  const linkModeBanner = document.getElementById("link-mode-banner");
  const btnVariantA = document.getElementById("btn-variant-A");
  const btnVariantB = document.getElementById("btn-variant-B");
  const btnToggleDimsEl = document.getElementById("btn-toggle-dims");
  const btnToggleEditorEl = document.getElementById("btn-toggle-editor");
  const editsBtnCountEl = document.getElementById("edits-btn-count");
  const editsTabCountEl = document.getElementById("edits-tab-count");
  const modalBackdropEl = document.getElementById("modal-backdrop");
  const modalBoxEl = document.getElementById("modal-box");
  const floatingLegendEl = document.getElementById("floating-legend");
  const masterOffBannerEl = document.getElementById("master-off-banner");
  const btnRestoreMasterEl = document.getElementById("btn-restore-master-light");
  const btnUndoLightEl = document.getElementById("btn-undo-light");

  let suppressNextClick = false;
  let sidebarDragPayload = null;
  const MAX_LIGHTING_HISTORY = 60;
  const lightingUndoStack = [];
  const lightingRedoStack = [];
  let lastSavedLightingSnap = null;
  let isApplyingLightingUndo = false;

  /* ==================== PERSISTENCE & UNDO/REDO ==================== */

  function captureLightingSnap() {
    return JSON.stringify({
      variant: state.variant,
      masterLightOn: state.masterLightOn,
      masterSwitchDeleted: state.masterSwitchDeleted,
      groups: state.groups,
      switches: state.switches,
      fixtureComments: state.fixtureComments
    });
  }

  function updateLightingUndoUI() {
    if (btnUndoLightEl) {
      btnUndoLightEl.disabled = lightingUndoStack.length === 0;
    }
  }

  function applyLightingSnap(snapStr) {
    try {
      const parsed = JSON.parse(snapStr);
      if (!parsed || !Array.isArray(parsed.groups) || !Array.isArray(parsed.switches)) return;
      const prevSettings = state.groupSettings || {};
      isApplyingLightingUndo = true;
      state.variant = parsed.variant === "B" ? "B" : "A";
      state.masterLightOn = parsed.masterLightOn === false ? false : true;
      state.masterSwitchDeleted = !!parsed.masterSwitchDeleted;
      state.groups = parsed.groups;
      state.switches = parsed.switches;
      state.fixtureComments = parsed.fixtureComments || {};
      state.groupSettings = buildInitialGroupSettings(state.groups);
      Object.keys(state.groupSettings).forEach((gid) => {
        if (prevSettings[gid]) state.groupSettings[gid] = prevSettings[gid];
      });
      if (state.selectedSwitchId && !getSwitchById(state.selectedSwitchId)) {
        state.selectedSwitchId = null;
      }
      if (state.popoverKind === "switch" && state.popoverId && !getSwitchById(state.popoverId)) {
        state.popoverKind = null;
        state.popoverId = null;
      }
      if (btnVariantA) btnVariantA.classList.toggle("is-active", state.variant === "A");
      if (btnVariantB) btnVariantB.classList.toggle("is-active", state.variant === "B");
      lastSavedLightingSnap = snapStr;
      saveToStorage();
      renderAll();
    } catch (err) {
      // ignore invalid snapshot
    } finally {
      isApplyingLightingUndo = false;
      updateLightingUndoUI();
    }
  }

  function undoLightingAction() {
    if (!lightingUndoStack.length) return;
    lightingRedoStack.push(captureLightingSnap());
    const prev = lightingUndoStack.pop();
    applyLightingSnap(prev);
  }

  function redoLightingAction() {
    if (!lightingRedoStack.length) return;
    lightingUndoStack.push(captureLightingSnap());
    const next = lightingRedoStack.pop();
    applyLightingSnap(next);
  }

  function saveToStorage() {
    try {
      const curSnap = captureLightingSnap();
      if (!isApplyingLightingUndo && lastSavedLightingSnap && curSnap !== lastSavedLightingSnap) {
        lightingUndoStack.push(lastSavedLightingSnap);
        if (lightingUndoStack.length > MAX_LIGHTING_HISTORY) lightingUndoStack.shift();
        lightingRedoStack.length = 0;
        lastSavedLightingSnap = curSnap;
        updateLightingUndoUI();
      } else if (!lastSavedLightingSnap) {
        lastSavedLightingSnap = curSnap;
      }
      const payload = {
        variant: state.variant,
        masterLightOn: state.masterLightOn,
        masterSwitchDeleted: state.masterSwitchDeleted,
        showDims: state.showDims,
        groups: state.groups,
        switches: state.switches,
        fixtureComments: state.fixtureComments
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      // ignore storage errors in restricted environments
    }
  }

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.groups) && Array.isArray(parsed.switches)) {
        state.variant = parsed.variant === "B" ? "B" : "A";
        state.groups = parsed.groups;
        state.switches = parsed.switches;
        state.fixtureComments = parsed.fixtureComments || {};
        state.groupSettings = buildInitialGroupSettings(state.groups);
        state.masterSwitchDeleted = !!parsed.masterSwitchDeleted;
        state.masterLightOn = parsed.masterLightOn === false ? false : true;
        if (!state.masterSwitchDeleted && !state.switches.some((s) => isMasterSwitch(s))) {
          const baseMaster = baselineSwitchMap.get("BM");
          if (baseMaster) {
            const b1Idx = state.switches.findIndex((s) => s.id === "B1");
            const copy = deepClone(baseMaster);
            if (b1Idx !== -1) state.switches.splice(b1Idx + 1, 0, copy);
            else state.switches.unshift(copy);
          }
        }
      }
    } catch (err) {
      // ignore corrupted storage
    }
  }

  /* ==================== HELPERS ==================== */

  function getGroupById(gid) {
    return state.groups.find((g) => g.id === gid) || null;
  }

  function getSwitchById(id) {
    return state.switches.find((s) => s.id === id) || null;
  }

  function ensureGroupSetting(gid) {
    if (!state.groupSettings[gid]) {
      state.groupSettings[gid] = {
        on: false,
        brightness: gid === "Z-08" ? 90 : 100,
        color: gid === "Z-08" ? "#ff3b5c" : null,
        scene: null
      };
    }
    return state.groupSettings[gid];
  }

  function isMasterSwitch(sw) {
    if (!sw) return false;
    if (sw.id === "BM" || sw.isMaster || sw.deviceType === "master_light") return true;
    const dt = DATA.deviceTypes[sw.deviceType];
    return !!(dt && dt.isMaster);
  }

  function hasActiveMasterSwitch() {
    return state.switches.some((s) => isMasterSwitch(s));
  }

  function isMasterPowerActive() {
    return !hasActiveMasterSwitch() || state.masterLightOn !== false;
  }

  function isGroupRawOn(gid) {
    return !!ensureGroupSetting(gid).on;
  }

  function isGroupOn(gid) {
    const g = getGroupById(gid);
    if (g && g.isNonLight) return isGroupRawOn(gid);
    return isMasterPowerActive() && isGroupRawOn(gid);
  }

  function getEffectiveKeys(sw) {
    return (sw.keys || []).filter((k) => !k.variantOnly || k.variantOnly === state.variant);
  }

  function getKeyTargetGroups(key) {
    if (!key) return [];
    if (Array.isArray(key.targets) && key.targets.length) {
      return key.targets.slice();
    }
    if (key.group === "BAL-ALL") {
      return ["BAL-01", "BAL-02"];
    }
    return key.group ? [key.group] : [];
  }

  function isEmptyKey(key) {
    return !key || getKeyTargetGroups(key).length === 0;
  }

  function normalizeSwitchKeys(sw) {
    if (!sw || !Array.isArray(sw.keys)) return;
    while (sw.keys.length > 0 && isEmptyKey(sw.keys[sw.keys.length - 1])) {
      sw.keys.pop();
    }
    sw.keys.forEach((k, i) => {
      k.key = i + 1;
    });
  }

  function isKeyOn(key) {
    return getKeyTargetGroups(key).some((gid) => isGroupOn(gid));
  }

  function toggleKey(key, forceVal) {
    const targets = getKeyTargetGroups(key);
    if (!targets.length) return;
    const rawOn = targets.some((gid) => isGroupRawOn(gid));
    const next = typeof forceVal === "boolean" ? forceVal : !rawOn;
    targets.forEach((gid) => {
      ensureGroupSetting(gid).on = next;
    });
  }

  function getKeyFixtures(key) {
    const ids = new Set();
    getKeyTargetGroups(key).forEach((gid) => {
      const g = getGroupById(gid);
      if (g) g.fixtures.forEach((fid) => ids.add(fid));
    });
    return Array.from(ids).sort((a, b) => a - b);
  }

  function getSwitchFixtures(sw) {
    const ids = new Set();
    getEffectiveKeys(sw).forEach((k) => {
      getKeyFixtures(k).forEach((fid) => ids.add(fid));
    });
    return Array.from(ids).sort((a, b) => a - b);
  }

  function getEffectiveDeviceType(sw) {
    const dt = DATA.deviceTypes[sw.deviceType] || DATA.deviceTypes.rocker_1;
    if (sw.id === "B15" && state.variant === "B") {
      const effLen = getEffectiveKeys(sw).length;
      if (effLen <= 1) {
        if (sw.deviceType === "button_2") return DATA.deviceTypes.button_1;
        if (sw.deviceType === "rocker_2" || sw.deviceType === "rocker_3") return DATA.deviceTypes.rocker_1;
      } else if (effLen === 2 && sw.deviceType === "rocker_3") {
        return DATA.deviceTypes.rocker_2;
      }
    }
    return dt;
  }

  function getSwitchStatus(sw) {
    if (isMasterSwitch(sw)) {
      const powerOn = isMasterPowerActive();
      const activeFixtures = DATA.fixtures.filter(
        (f) => !f.isNonLight && getFixtureActiveGroups(f.id).length > 0
      ).length;
      return {
        isOn: powerOn,
        isMasterCut: !powerOn,
        isPartial: false,
        keyStates: [powerOn],
        activeKeys: powerOn ? 1 : 0,
        totalKeys: 1,
        activeFixtures
      };
    }
    const keys = getEffectiveKeys(sw);
    const keyStates = keys.map((k) => isKeyOn(k));
    const allTargets = keys.flatMap((k) => getKeyTargetGroups(k));
    const activeTargets = allTargets.filter((gid) => isGroupOn(gid)).length;
    return {
      isOn: keyStates.some(Boolean),
      isMasterCut: false,
      isPartial: activeTargets > 0 && activeTargets < allTargets.length,
      keyStates,
      activeKeys: keyStates.filter(Boolean).length,
      totalKeys: keys.length
    };
  }

  function getFixtureActiveGroups(fixtureId) {
    return state.groups.filter((g) => g.fixtures.includes(fixtureId) && isGroupOn(g.id));
  }

  function getFixtureGroups(fixtureId) {
    return state.groups.filter((g) => g.fixtures.includes(fixtureId));
  }

  function getSwitchesForFixture(fixtureId) {
    return state.switches.filter((sw) => !isMasterSwitch(sw) && getSwitchFixtures(sw).includes(fixtureId));
  }

  function isDesktopLayout() {
    return window.innerWidth >= 980;
  }

  function toggleGroup(groupId, forceVal) {
    const st = ensureGroupSetting(groupId);
    st.on = typeof forceVal === "boolean" ? forceVal : !st.on;
  }

  function hexToRgba(hex, alpha) {
    const clean = hex.replace("#", "");
    const num = parseInt(clean, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function createSvgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
    return el;
  }

  function formatPts(pts) {
    return pts.map((p) => `${p[0]},${p[1]}`).join(" ");
  }

  function lerpPt(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ==================== EDITS & EXPORT ENGINE ==================== */

  function computeEditsSummary() {
    const diffs = [];

    if (state.variant !== "A") {
      diffs.push({
        kind: "change",
        label: "Выбран Вариант B для №38 (управление только у кровати B17, без проходной клавиши на B15)"
      });
    }

    // Added, moved, type-changed, or rebound switches
    state.switches.forEach((sw) => {
      const base = baselineSwitchMap.get(sw.id);
      const dt = DATA.deviceTypes[sw.deviceType] || DATA.deviceTypes.rocker_1;
      const keyGroups = (sw.keys || []).map((k) => getKeyTargetGroups(k).join("+"));

      if (!base) {
        const fx = getSwitchFixtures(sw).map((n) => `№${n}`).join(", ") || "без ламп";
        const keyDetails =
          keyGroups.length > 1
            ? `, клавиши: [${keyGroups.map((kg, i) => `Кл.${i + 1}: ${kg || "свободно"}`).join(", ")}]`
            : "";
        diffs.push({
          kind: "change",
          label: `Добавлен новый выключатель ${sw.id} (${sw.room}, позиция: (${sw.x}, ${sw.y}), тип: ${dt.fullLabel}, привязка: ${fx}${keyDetails})`
        });
      } else {
        const dist = Math.hypot(sw.x - base.x, sw.y - base.y);
        if (dist >= 4) {
          diffs.push({
            kind: "change",
            label: `Перемещён ${sw.id} (${sw.room}): новая позиция на плане (${sw.x}, ${sw.y})`
          });
        }
        if (sw.deviceType !== base.deviceType) {
          const baseDt = DATA.deviceTypes[base.deviceType];
          diffs.push({
            kind: "change",
            label: `Изменён тип ${sw.id} (${sw.room}): «${baseDt.fullLabel}» → «${dt.fullLabel}»`
          });
        }
        if (sw.room !== base.room) {
          diffs.push({
            kind: "change",
            label: `Изменено помещение ${sw.id}: ${base.room} → ${sw.room}`
          });
        }
        const baseKeys = base.keys.map((k) => getKeyTargetGroups(k).join("+"));
        if (JSON.stringify(keyGroups) !== JSON.stringify(baseKeys)) {
          const fx = getSwitchFixtures(sw).map((n) => `№${n}`).join(", ") || "пусто";
          if (
            keyGroups.length === 2 &&
            baseKeys.length === 2 &&
            keyGroups[0] === baseKeys[1] &&
            keyGroups[1] === baseKeys[0]
          ) {
            diffs.push({
              kind: "change",
              label: `Поменяны местами клавиши ${sw.id} (${sw.room}): Кл.1 → ${keyGroups[0]}, Кл.2 → ${keyGroups[1]} (${fx})`
            });
          } else {
            const formatted = keyGroups
              .map((kg, i) => (keyGroups.length > 1 ? `Кл.${i + 1}: ${kg || "свободно"}` : kg))
              .join(", ");
            diffs.push({
              kind: "change",
              label: `Изменены клавиши ${sw.id} (${sw.room}): [${formatted || "нет"}] (${fx})`
            });
          }
        }
      }

      const curComment = (sw.comment || "").trim();
      const baseComment = base ? (base.comment || "").trim() : "";
      if (curComment && curComment !== baseComment) {
        diffs.push({
          kind: "comment",
          target: sw.id,
          label: `Комментарий к выключателю ${sw.id} (${sw.room}): ${curComment}`
        });
      }
    });

    // Deleted baseline switches
    BASELINE_SWITCHES.forEach((base) => {
      if (!getSwitchById(base.id)) {
        diffs.push({
          kind: "change",
          label: `Удалён выключатель ${base.id} (${base.room})`
        });
      }
    });

    // Modified or custom groups
    state.groups.forEach((g) => {
      const baseG = baselineGroupMap.get(g.id);
      if (!baseG) {
        diffs.push({
          kind: "change",
          label: `Выделена новая группа ${g.id} (${g.room}): светильники ${g.fixtures.map((n) => `№${n}`).join(", ")}`
        });
      } else if (JSON.stringify(g.fixtures.slice().sort((a, b) => a - b)) !== JSON.stringify(baseG.fixtures.slice().sort((a, b) => a - b))) {
        diffs.push({
          kind: "change",
          label: `Изменён состав группы ${g.id}: было [${baseG.fixtures.join(", ")}] → стало [${g.fixtures.join(", ")}]`
        });
      }
    });

    // Fixture comments
    Object.keys(state.fixtureComments)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((fid) => {
        const txt = (state.fixtureComments[fid] || "").trim();
        if (txt) {
          const f = fixturesById.get(fid);
          diffs.push({
            kind: "comment",
            target: `№${fid}`,
            label: `Комментарий к светильнику №${fid} (${f ? f.room : ""}): ${txt}`
          });
        }
      });

    return diffs;
  }

  function buildExportMarkdown() {
    const diffs = computeEditsSummary();
    const lines = [
      "### Мои правки по схеме освещения"
    ];

    const changes = diffs.filter((d) => d.kind === "change");
    const comments = diffs.filter((d) => d.kind === "comment");

    if (changes.length) {
      lines.push("", "**Изменения по выключателям и привязкам:**");
      changes.forEach((c) => lines.push(`- ${c.label}`));
    }

    if (comments.length) {
      lines.push("", "**Комментарии:**");
      comments.forEach((c) => lines.push(`- ${c.label}`));
    }

    if (!changes.length && !comments.length) {
      lines.push("", "_Пока изменений и комментариев относительно актуальной схемы BM, B1–B25 нет._");
    }

    return lines.join("\n");
  }

  function updateEditBadges() {
    const count = computeEditsSummary().length;
    editsBtnCountEl.textContent = String(count);
    editsTabCountEl.textContent = String(count);
  }

  /* ==================== BIND / UNBIND / ADD / DELETE / CONVERT LOGIC ==================== */

  function isSwitchSpotFree(x, y) {
    for (const s of state.switches) {
      if (Math.abs(s.x - x) < 60 && Math.abs(s.y - y) < 60) {
        return false;
      }
    }
    for (const f of DATA.fixtures) {
      const cx = Math.max(x - 27, Math.min(f.cx, x + 27));
      const cy = Math.max(y - 27, Math.min(f.cy, y + 27));
      if (Math.hypot(f.cx - cx, f.cy - cy) < f.r + 6) {
        return false;
      }
    }
    return true;
  }

  function findNearbyFreeSwitchSpot(baseX, baseY) {
    const offsets = [
      [0, 68],
      [0, -68],
      [68, 0],
      [-68, 0],
      [68, 68],
      [-68, 68],
      [68, -68],
      [-68, -68],
      [0, 136],
      [0, -136],
      [136, 0],
      [-136, 0]
    ];
    for (const [dx, dy] of offsets) {
      const cx = Math.round(Math.max(420, Math.min(2150, baseX + dx)));
      const cy = Math.round(Math.max(160, Math.min(2200, baseY + dy)));
      if (isSwitchSpotFree(cx, cy)) return { x: cx, y: cy };
    }
    return {
      x: Math.round(Math.max(420, Math.min(2150, baseX + 68))),
      y: Math.round(Math.max(160, Math.min(2200, baseY)))
    };
  }

  function buildMergedKeyObject(targetGroupIds) {
    const unique = Array.from(new Set(targetGroupIds)).filter(Boolean);
    const fxNums = new Set();
    const parts = [];
    unique.forEach((gid) => {
      const g = getGroupById(gid);
      if (g) {
        g.fixtures.forEach((n) => fxNums.add(n));
        parts.push(g.purpose);
      }
    });
    const fxStr = Array.from(fxNums)
      .sort((a, b) => a - b)
      .map((n) => `№${n}`)
      .join(", ");
    const shortTitle = parts.length <= 2 ? parts.join(" + ") : `${unique.join(" + ")}`;
    return {
      key: 1,
      group: unique[0] || "MERGED",
      targets: unique,
      label: `Общая клавиша: ${shortTitle} (${fxStr || "пусто"})`
    };
  }

  function expandMergedKeyToKeys(sw, maxKeys) {
    const active = (sw && sw.keys ? sw.keys : []).filter((k) => !isEmptyKey(k));
    if (!sw || active.length !== 1) return false;
    const only = active[0];
    const targets = getKeyTargetGroups(only);
    if (targets.length < 2) return false;

    const limit = Math.max(2, maxKeys || 2);
    const newKeys = [];
    targets.slice(0, limit).forEach((gid, idx) => {
      const g = getGroupById(gid);
      if (g) {
        newKeys.push({
          key: idx + 1,
          group: g.id,
          label: `${g.purpose} (${g.fixtures.map((n) => `№${n}`).join(", ")})`
        });
      }
    });
    if (targets.length > limit && newKeys.length === limit) {
      newKeys[limit - 1] = buildMergedKeyObject(targets.slice(limit - 1));
      newKeys[limit - 1].key = limit;
    }
    if (newKeys.length >= 2) {
      sw.keys = newKeys;
      if (sw.specialLogic === "balcony_all") delete sw.specialLogic;
      return true;
    }
    return false;
  }

  function adjustDeviceTypeAfterKeyCountChange(sw, allowDowngrade) {
    if (!sw) return;
    const count = getEffectiveKeys(sw).length;
    if (count >= 3) {
      if (sw.deviceType === "rocker_1" || sw.deviceType === "rocker_2") {
        sw.deviceType = "rocker_3";
      }
    } else if (count === 2) {
      if (sw.deviceType === "rocker_1") sw.deviceType = "rocker_2";
      else if (sw.deviceType === "button_1") sw.deviceType = "button_2";
      else if (allowDowngrade && sw.deviceType === "rocker_3") sw.deviceType = "rocker_2";
    } else if (allowDowngrade && count <= 1) {
      if (sw.deviceType === "rocker_2" || sw.deviceType === "rocker_3") sw.deviceType = "rocker_1";
      else if (sw.deviceType === "button_2") sw.deviceType = "button_1";
    }
  }

  function applyKeySlotAction(sw, keyObj, strategy, targetSlotIdx) {
    // strategy: "append" | "expand_2" | "expand_3" | "merge" | "replace"
    const dt = getEffectiveDeviceType(sw);
    const effKeys = getEffectiveKeys(sw);
    const targetIdx = typeof targetSlotIdx === "number" ? targetSlotIdx : 0;
    const targetIsEmpty = effKeys[targetIdx] && isEmptyKey(effKeys[targetIdx]);

    if (strategy === "merge") {
      const slot = Math.min(Math.max(0, targetIdx), Math.max(0, effKeys.length - 1));
      const baseKey = effKeys[slot];
      const mergedTargets = (baseKey ? getKeyTargetGroups(baseKey) : []).concat(getKeyTargetGroups(keyObj));
      const mergedObj = buildMergedKeyObject(mergedTargets);
      if (baseKey) {
        const realIdx = sw.keys.indexOf(baseKey);
        if (realIdx !== -1) {
          mergedObj.key = realIdx + 1;
          sw.keys[realIdx] = mergedObj;
        }
      } else {
        sw.keys.push(mergedObj);
      }
      if (sw.specialLogic === "balcony_all") delete sw.specialLogic;
    } else if (strategy === "replace") {
      const slot = Math.min(Math.max(0, targetIdx), Math.max(0, effKeys.length - 1));
      const oldKey = effKeys[slot];
      const copy = deepClone(keyObj);
      delete copy.variantOnly;
      if (oldKey) {
        const realIdx = sw.keys.indexOf(oldKey);
        if (realIdx !== -1) {
          copy.key = realIdx + 1;
          sw.keys[realIdx] = copy;
        }
      } else {
        sw.keys.push(copy);
      }
      if (sw.specialLogic === "balcony_all") delete sw.specialLogic;
    } else if (
      effKeys.length < dt.maxRecommendedKeys ||
      strategy === "expand_2" ||
      strategy === "expand_3" ||
      targetIsEmpty
    ) {
      // Default append / expand_2 / expand_3 / fill empty slot
      const copy = deepClone(keyObj);
      delete copy.variantOnly;

      if (strategy === "expand_3") {
        sw.deviceType = "rocker_3";
      } else if (strategy === "expand_2") {
        sw.deviceType = sw.deviceType === "button_1" ? "button_2" : "rocker_2";
      }

      const maxAfter = getEffectiveDeviceType(sw).maxRecommendedKeys;
      if (targetIdx >= 0 && (maxAfter >= 2 || strategy === "expand_2" || strategy === "expand_3")) {
        if (effKeys[targetIdx] && isEmptyKey(effKeys[targetIdx])) {
          const r = sw.keys.indexOf(effKeys[targetIdx]);
          if (r !== -1) sw.keys[r] = copy;
          else sw.keys.push(copy);
        } else if (targetIdx >= effKeys.length) {
          while (getEffectiveKeys(sw).length < targetIdx) {
            sw.keys.push({ key: sw.keys.length + 1, group: "", label: "Свободно" });
          }
          sw.keys.push(copy);
        } else {
          sw.keys.push(copy);
        }
        adjustDeviceTypeAfterKeyCountChange(sw, false);
      } else if (targetIdx === 0 && effKeys[0] && isEmptyKey(effKeys[0])) {
        const r0 = sw.keys.indexOf(effKeys[0]);
        if (r0 !== -1) sw.keys[r0] = copy;
        else sw.keys.unshift(copy);
      } else {
        sw.keys.push(copy);
        adjustDeviceTypeAfterKeyCountChange(sw, false);
      }
      if (sw.specialLogic === "balcony_all") delete sw.specialLogic;
    } else {
      applyKeySlotAction(sw, keyObj, "merge", targetIdx);
      return;
    }

    normalizeSwitchKeys(sw);
  }

  function createCustomGroupForFixture(sourceGroupId, fixtureId) {
    const srcGroup = getGroupById(sourceGroupId);
    const f = fixturesById.get(fixtureId);
    if (!srcGroup || !f) return null;

    srcGroup.fixtures = srcGroup.fixtures.filter((id) => id !== fixtureId);
    state.switches.forEach((s) => {
      s.keys.forEach((k) => {
        if (k.group === srcGroup.id && !k.targets) {
          k.label = `${srcGroup.purpose} (${srcGroup.fixtures.map((n) => `№${n}`).join(", ")})`;
        }
      });
    });

    let n = 1;
    while (getGroupById(`GRP-${n}`)) n += 1;
    const newId = `GRP-${n}`;
    const newGroup = {
      id: newId,
      room: f.room,
      fixtures: [fixtureId],
      isCustom: true,
      purpose: `${f.name} (выделено отдельно)`,
      control: "Выделенная пользователем группа"
    };
    state.groups.push(newGroup);
    ensureGroupSetting(newId);
    return newGroup;
  }

  function addNewSwitch(opts) {
    const o = opts && !(opts instanceof Event) ? opts : {};
    const isMasterType = o.deviceType === "master_light";
    let newId = "";
    if (isMasterType && !getSwitchById("BM")) {
      newId = "BM";
    } else {
      let num = 26;
      while (getSwitchById(`B${num}`)) num += 1;
      newId = `B${num}`;
    }

    let x = o.x;
    let y = o.y;
    if (typeof x !== "number" || typeof y !== "number") {
      if (isMasterType) {
        x = 1800;
        y = 1514;
      } else {
        const vpRect = viewportEl.getBoundingClientRect();
        const cx = (vpRect.width / 2 - state.panX) / state.zoom;
        const cy = (vpRect.height / 2 - state.panY) / state.zoom;
        x = Math.round(Math.max(420, Math.min(2150, cx)));
        y = Math.round(Math.max(160, Math.min(2200, cy)));
      }
      if (!isSwitchSpotFree(x, y)) {
        const spot = findNearbyFreeSwitchSpot(x, y);
        x = spot.x;
        y = spot.y;
      }
    }

    const newSw = {
      id: newId,
      room: o.room || (isMasterType ? "Прихожая" : "Зал"),
      title:
        o.title ||
        (isMasterType
          ? "Прихожая — Мастер-свет у входа (только освещение №1–39)"
          : `Новый пост ${newId} (перетащите на стену)`),
      x,
      y,
      deviceType: o.deviceType || "rocker_1",
      isMaster: isMasterType,
      heightNote: isMasterType
        ? "Отдельная высота ~140–150 см от пола на нижней стене прихожей, чтобы не нажимать случайно вместо B1"
        : "Предварительно, ~90 см от чистого пола",
      doorCheck: false,
      doorNote:
        o.doorNote ||
        (isMasterType
          ? "Через контактор в щите: только свет №1–39 (розетки, кормушки и вентиляция №40 не трогает)"
          : "Добавлено пользователем"),
      comment: "",
      keys: o.keys
        ? deepClone(o.keys)
        : isMasterType
        ? [{ key: 1, group: null, targets: [], label: "Мастер-выключатель всего света (№1–39). Розетки и вентиляция №40 не отключает." }]
        : []
    };
    if (isMasterType) {
      state.masterSwitchDeleted = false;
      state.masterLightOn = true;
    }
    state.switches.push(newSw);
    state.selectedSwitchId = newId;
    state.selectedFixtureId = null;
    if (!isDesktopLayout() && !o.silent) {
      state.popoverKind = "switch";
      state.popoverId = newId;
    } else {
      state.popoverKind = null;
      state.popoverId = null;
    }
    if (!o.skipSaveAndRender) {
      saveToStorage();
      renderAll();
    }
    return newSw;
  }

  function openAddSwitchModal() {
    let defaultRoom = "Зал";
    if (state.selectedSwitchId) {
      const selSw = getSwitchById(state.selectedSwitchId);
      if (selSw && ROOM_ORDER.includes(selSw.room)) defaultRoom = selSw.room;
    } else if (state.selectedFixtureId) {
      const selFx = fixturesById.get(state.selectedFixtureId);
      if (selFx && ROOM_ORDER.includes(selFx.room)) defaultRoom = selFx.room;
    }

    const roomOptions = ROOM_ORDER.map(
      (r) => `<option value="${r}" ${r === defaultRoom ? "selected" : ""}>${r}</option>`
    ).join("");

    const typeButtons = Object.values(DATA.deviceTypes)
      .filter((t) => !t.isMaster || !hasActiveMasterSwitch())
      .map((t) => {
        const preview = renderSwitchFaceplateHtml(t.id, {
          sizeClass: "is-mini",
          keyCount: t.maxRecommendedKeys,
          keyStates: [!!t.isMaster],
          slotEmpty: [false, false, false],
          brightness: 80
        });
        const subDesc =
          t.id === "master_light"
            ? "Отключает все группы света №1–39 через контактор (розетки и вентиляцию №40 не трогает)"
            : t.id === "rocker_3"
            ? "3 независимые клавиши в 1 механизме (3 канала)"
            : t.hasRgb
            ? "Поворотно-нажимной регулятор: вкл/выкл, яркость и цвет RGB (1 канал)"
            : t.hasDimmer
            ? "Включение/выключение и регулировка яркости (1 канал)"
            : t.isImpulse
            ? `Импульсная кнопка (${t.maxRecommendedKeys} кл.)`
            : `${t.maxRecommendedKeys} кл., стандартный механизм`;
        return `
          <button type="button" class="modal-choice-btn is-row" data-add-sw-type="${t.id}">
            ${preview}
            <span class="modal-choice-text">
              <span class="modal-choice-title">${escapeHtml(t.fullLabel)} (${escapeHtml(t.shortLabel)})</span>
              <span class="modal-choice-sub">${subDesc}</span>
            </span>
          </button>
        `;
      })
      .join("");

    modalBoxEl.innerHTML = `
      <div class="modal-header">
        <h3>Добавить новый выключатель</h3>
        <button type="button" class="pop-close" data-modal-close="1">✕</button>
      </div>
      <div class="field-row-inline">
        <label class="field-label" for="add-sw-room-select" style="white-space:nowrap;">Помещение:</label>
        <select id="add-sw-room-select" class="field-select">${roomOptions}</select>
      </div>
      <div class="slot-picker-label">Выберите тип механизма:</div>
      <div class="modal-choice-list">${typeButtons}</div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" data-modal-close="1">Отмена</button>
      </div>
    `;
    modalBackdropEl.classList.remove("is-hidden");

    modalBoxEl.querySelectorAll("[data-modal-close]").forEach((b) =>
      b.addEventListener("click", closeModal)
    );
    modalBoxEl.querySelectorAll("[data-add-sw-type]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const roomEl = document.getElementById("add-sw-room-select");
        const roomVal = roomEl ? roomEl.value : defaultRoom;
        const typeId = btn.getAttribute("data-add-sw-type");
        addNewSwitch({ deviceType: typeId, room: roomVal });
        closeModal();
      })
    );
  }

  function deleteSwitch(swId) {
    const sw = getSwitchById(swId);
    if (!sw) return;
    const wasMaster = isMasterSwitch(sw);
    state.switches = state.switches.filter((s) => s.id !== swId);
    if (wasMaster && !hasActiveMasterSwitch()) {
      state.masterSwitchDeleted = true;
      state.masterLightOn = true;
    }
    if (state.selectedSwitchId === swId) state.selectedSwitchId = null;
    if (state.popoverKind === "switch" && state.popoverId === swId) {
      state.popoverKind = null;
      state.popoverId = null;
    }
    saveToStorage();
    renderAll();
  }

  function removeGroupFromOtherSwitches(groupId, exceptSwId) {
    state.switches.forEach((other) => {
      if (other.id === exceptSwId) return;
      const nextKeys = [];
      let changed = false;
      other.keys.forEach((k) => {
        if (k.targets && k.targets.includes(groupId)) {
          changed = true;
          const rest = k.targets.filter((tid) => tid !== groupId);
          if (rest.length === 1) {
            const g = getGroupById(rest[0]);
            if (g) {
              nextKeys.push({
                key: nextKeys.length + 1,
                group: g.id,
                label: `${g.purpose} (${g.fixtures.map((n) => `№${n}`).join(", ")})`
              });
            }
          } else if (rest.length > 1) {
            nextKeys.push(buildMergedKeyObject(rest));
          }
        } else if (k.group === groupId) {
          changed = true;
        } else {
          nextKeys.push(k);
        }
      });
      if (changed) {
        other.keys = nextKeys;
        normalizeSwitchKeys(other);
        adjustDeviceTypeAfterKeyCountChange(other, true);
      }
    });
  }

  function bindGroupToSwitch(groupId, targetSwId, mode, slotStrategy, targetSlotIdx) {
    const sw = getSwitchById(targetSwId);
    const g = getGroupById(groupId);
    if (!sw || !g) return;

    const strat = slotStrategy || "append";
    const targetKeyRef =
      strat === "merge" || strat === "replace"
        ? getEffectiveKeys(sw)[targetSlotIdx || 0] || null
        : null;

    if (mode === "move") {
      removeGroupFromOtherSwitches(groupId, targetSwId);
      const nextSameSwKeys = [];
      const sameSwMulti = getEffectiveDeviceType(sw).maxRecommendedKeys >= 2;
      sw.keys.forEach((k) => {
        if (k === targetKeyRef) {
          nextSameSwKeys.push(k);
          return;
        }
        if (k.targets && k.targets.includes(groupId)) {
          const rest = k.targets.filter((tid) => tid !== groupId);
          if (rest.length === 1) {
            const rg = getGroupById(rest[0]);
            if (rg) {
              nextSameSwKeys.push({
                key: nextSameSwKeys.length + 1,
                group: rg.id,
                label: `${rg.purpose} (${rg.fixtures.map((n) => `№${n}`).join(", ")})`
              });
            }
          } else if (rest.length > 1) {
            nextSameSwKeys.push(buildMergedKeyObject(rest));
          } else if (sameSwMulti) {
            nextSameSwKeys.push({ key: nextSameSwKeys.length + 1, group: "", label: "Свободно" });
          }
        } else if (k.group === groupId) {
          if (sameSwMulti) {
            nextSameSwKeys.push({ key: nextSameSwKeys.length + 1, group: "", label: "Свободно" });
          }
        } else {
          nextSameSwKeys.push(k);
        }
      });
      sw.keys = nextSameSwKeys;
      normalizeSwitchKeys(sw);
    }

    const updatedEff = getEffectiveKeys(sw);
    const updatedSlotIdx = targetKeyRef
      ? Math.max(0, updatedEff.indexOf(targetKeyRef))
      : targetSlotIdx || 0;
    const alreadyOnTarget = targetKeyRef
      ? getKeyTargetGroups(targetKeyRef).includes(groupId)
      : false;

    if (!alreadyOnTarget || strat === "replace") {
      applyKeySlotAction(
        sw,
        {
          key: sw.keys.length + 1,
          group: groupId,
          label: `${g.purpose} (${g.fixtures.map((n) => `№${n}`).join(", ")})`
        },
        strat,
        updatedSlotIdx
      );
    }
    saveToStorage();
    renderAll();
  }

  function splitFixtureToNewGroup(sourceGroupId, fixtureId, targetSwId, slotStrategy, targetSlotIdx) {
    const sw = getSwitchById(targetSwId);
    const f = fixturesById.get(fixtureId);
    if (!sw || !f) return;
    const newGroup = createCustomGroupForFixture(sourceGroupId, fixtureId);
    if (!newGroup) return;

    applyKeySlotAction(
      sw,
      {
        key: sw.keys.length + 1,
        group: newGroup.id,
        label: `Светильник №${fixtureId} (${f.name})`
      },
      slotStrategy || "append",
      targetSlotIdx
    );
    saveToStorage();
    renderAll();
  }

  function removeKeySlotPreservingPositions(sw, realIdx) {
    if (!sw || realIdx < 0 || realIdx >= sw.keys.length) return;
    const maxSlots = getEffectiveDeviceType(sw).maxRecommendedKeys;
    const hasLaterActive = sw.keys.slice(realIdx + 1).some((k) => !isEmptyKey(k));
    if (maxSlots >= 2 && hasLaterActive) {
      sw.keys[realIdx] = { key: realIdx + 1, group: "", label: "Свободно" };
    } else {
      sw.keys.splice(realIdx, 1);
    }
    normalizeSwitchKeys(sw);
  }

  function unbindKeyAtIndex(swId, effectiveIdx) {
    const sw = getSwitchById(swId);
    if (!sw) return;
    const eff = getEffectiveKeys(sw);
    const targetKey = eff[effectiveIdx];
    if (!targetKey) return;
    const realIdx = sw.keys.indexOf(targetKey);
    if (realIdx !== -1) {
      removeKeySlotPreservingPositions(sw, realIdx);
    }
    if (sw.specialLogic === "balcony_all") delete sw.specialLogic;
    saveToStorage();
    renderAll();
  }

  function removeSingleGroupFromKey(swId, effectiveIdx, groupId) {
    const sw = getSwitchById(swId);
    if (!sw) return;
    const eff = getEffectiveKeys(sw);
    const targetKey = eff[effectiveIdx];
    if (!targetKey) return;
    const realIdx = sw.keys.indexOf(targetKey);
    if (realIdx === -1) return;

    const rest = getKeyTargetGroups(targetKey).filter((gid) => gid !== groupId);
    if (!rest.length) {
      removeKeySlotPreservingPositions(sw, realIdx);
    } else if (rest.length === 1) {
      const rg = getGroupById(rest[0]);
      sw.keys[realIdx] = {
        key: realIdx + 1,
        group: rest[0],
        label: rg ? `${rg.purpose} (${rg.fixtures.map((n) => `№${n}`).join(", ")})` : rest[0]
      };
      normalizeSwitchKeys(sw);
    } else {
      const merged = buildMergedKeyObject(rest);
      merged.key = realIdx + 1;
      sw.keys[realIdx] = merged;
      normalizeSwitchKeys(sw);
    }
    if (sw.specialLogic === "balcony_all") delete sw.specialLogic;
    saveToStorage();
    renderAll();
  }

  function unbindSingleFixtureFromGroup(sourceGroupId, fixtureId) {
    const created = createCustomGroupForFixture(sourceGroupId, fixtureId);
    if (!created) return;
    saveToStorage();
    renderAll();
  }

  function swapKeys(fromSwId, fromKeyIdx, toSwId, toKeyIdx) {
    const fromSw = getSwitchById(fromSwId);
    const toSw = getSwitchById(toSwId);
    if (!fromSw || !toSw) return;
    const effFrom = getEffectiveKeys(fromSw);
    const effTo = getEffectiveKeys(toSw);

    if (fromSwId === toSwId) {
      if (fromKeyIdx === toKeyIdx) return;
      const dt = getEffectiveDeviceType(fromSw);
      const maxSlots = Math.max(dt.maxRecommendedKeys, effFrom.length);
      if (maxSlots < 2) return;
      if (fromKeyIdx < 0 || toKeyIdx < 0 || fromKeyIdx >= maxSlots || toKeyIdx >= maxSlots) return;

      const neededLen = Math.max(fromKeyIdx, toKeyIdx) + 1;
      while (getEffectiveKeys(fromSw).length < neededLen) {
        fromSw.keys.push({
          key: fromSw.keys.length + 1,
          group: "",
          label: "Свободно"
        });
      }

      const updatedEff = getEffectiveKeys(fromSw);
      const kA = updatedEff[fromKeyIdx];
      const kB = updatedEff[toKeyIdx];
      if (!kA || !kB || (isEmptyKey(kA) && isEmptyKey(kB))) return;
      const realA = fromSw.keys.indexOf(kA);
      const realB = fromSw.keys.indexOf(kB);
      if (realA === -1 || realB === -1) return;
      const tmp = fromSw.keys[realA];
      fromSw.keys[realA] = fromSw.keys[realB];
      fromSw.keys[realB] = tmp;
      normalizeSwitchKeys(fromSw);
    } else {
      const keyA = effFrom[fromKeyIdx];
      const keyB = effTo[toKeyIdx];
      if (!keyA || !keyB || isEmptyKey(keyA) || isEmptyKey(keyB)) return;
      const realA = fromSw.keys.indexOf(keyA);
      const realB = toSw.keys.indexOf(keyB);
      if (realA === -1 || realB === -1) return;
      const copyA = deepClone(keyA);
      const copyB = deepClone(keyB);
      delete copyA.variantOnly;
      delete copyB.variantOnly;
      fromSw.keys[realA] = copyB;
      toSw.keys[realB] = copyA;
      normalizeSwitchKeys(fromSw);
      normalizeSwitchKeys(toSw);
      if (fromSw.specialLogic === "balcony_all") delete fromSw.specialLogic;
      if (toSw.specialLogic === "balcony_all") delete toSw.specialLogic;
    }

    saveToStorage();
    renderAll();
  }

  function executeMoveKey(fromSwId, keyIndex, toSwId, slotStrategy, targetSlotIdx) {
    if (fromSwId === toSwId) return;
    const fromSw = getSwitchById(fromSwId);
    const toSw = getSwitchById(toSwId);
    if (!fromSw || !toSw) return;
    const effFrom = getEffectiveKeys(fromSw);
    const keyObj = effFrom[keyIndex];
    if (!keyObj || isEmptyKey(keyObj)) return;

    const realIdx = fromSw.keys.indexOf(keyObj);
    if (realIdx !== -1) {
      removeKeySlotPreservingPositions(fromSw, realIdx);
    }
    if (fromSw.specialLogic === "balcony_all") delete fromSw.specialLogic;

    const copy = deepClone(keyObj);
    delete copy.variantOnly;
    applyKeySlotAction(toSw, copy, slotStrategy || "append", targetSlotIdx);

    adjustDeviceTypeAfterKeyCountChange(fromSw, true);
    saveToStorage();
    renderAll();
  }

  function moveKeyToSwitch(fromSwId, keyIndex, toSwId) {
    if (fromSwId === toSwId) return;
    const fromSw = getSwitchById(fromSwId);
    const toSw = getSwitchById(toSwId);
    if (!fromSw || !toSw) return;
    const effFrom = getEffectiveKeys(fromSw);
    const keyObj = effFrom[keyIndex];
    if (!keyObj || isEmptyKey(keyObj)) return;

    const toDt = getEffectiveDeviceType(toSw);
    const toEff = getEffectiveKeys(toSw);
    for (let s = 0; s < toDt.maxRecommendedKeys; s++) {
      if (isEmptyKey(toEff[s])) {
        executeMoveKey(fromSwId, keyIndex, toSwId, "append", s);
        return;
      }
    }

    // Target switch is already at hardware key capacity -> ask user cleanly
    let btnsHtml = "";
    toEff.forEach((existingK, idx) => {
      if (isEmptyKey(existingK)) return;
      const slotName = toEff.length > 1 || toDt.maxRecommendedKeys >= 2 ? `клавишу ${idx + 1}` : `клавишу ${toSw.id}`;
      btnsHtml += `
        <button type="button" class="modal-choice-btn" data-slot-act="swap" data-slot-idx="${idx}">
          <span class="modal-choice-title">⇄ Поменять местами с ${slotName} (${getKeyTargetGroups(existingK).join("+")})</span>
          <span class="modal-choice-sub">На ${toSw.id} встанет ${getKeyTargetGroups(keyObj).join("+")}, а ${getKeyTargetGroups(existingK).join("+")} переедет в ${fromSw.id}</span>
        </button>
        <button type="button" class="modal-choice-btn" data-slot-act="merge" data-slot-idx="${idx}">
          <span class="modal-choice-title">Объединить с ${slotName} (${getKeyTargetGroups(existingK).join("+")})</span>
          <span class="modal-choice-sub">Обе группы будут включаться вместе одной клавишей</span>
        </button>
        <button type="button" class="modal-choice-btn" data-slot-act="replace" data-slot-idx="${idx}">
          <span class="modal-choice-title">Заменить ${slotName} (${getKeyTargetGroups(existingK).join("+")})</span>
          <span class="modal-choice-sub">Текущая привязка ${slotName} будет заменена на перетаскиваемую</span>
        </button>
      `;
    });

    if (toDt.id === "rocker_1" || toDt.id === "button_1") {
      btnsHtml += `
        <button type="button" class="modal-choice-btn" data-slot-act="expand_2" data-slot-idx="1">
          <span class="modal-choice-title">Расширить ${toSw.id} до 2-клавишного и добавить 2-й клавишей</span>
          <span class="modal-choice-sub">Тип ${toSw.id} изменится на 2-клавишный</span>
        </button>
      `;
    } else if (toDt.id === "rocker_2") {
      btnsHtml += `
        <button type="button" class="modal-choice-btn" data-slot-act="expand_3" data-slot-idx="2">
          <span class="modal-choice-title">Расширить ${toSw.id} до 3-клавишного и добавить 3-й клавишей</span>
          <span class="modal-choice-sub">Тип ${toSw.id} изменится на 3-клавишный</span>
        </button>
      `;
    }

    modalBoxEl.innerHTML = `
      <div class="modal-header">
        <h3>Выключатель ${toSw.id} (${toDt.shortLabel}) уже занят</h3>
        <button type="button" class="pop-close" data-modal-close="1">✕</button>
      </div>
      <div class="pop-note">Механизм <strong>${toDt.fullLabel}</strong> вмещает максимум ${toDt.maxRecommendedKeys} клавишу(и). Что сделать с перенесённой клавишей (${getKeyTargetGroups(keyObj).join("+")})?</div>
      <div class="modal-choice-list">${btnsHtml}</div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" data-modal-close="1">Отмена</button>
      </div>
    `;
    modalBackdropEl.classList.remove("is-hidden");
    modalBoxEl.querySelectorAll("[data-modal-close]").forEach((b) => b.addEventListener("click", closeModal));
    modalBoxEl.querySelectorAll("[data-slot-act]").forEach((b) =>
      b.addEventListener("click", () => {
        const act = b.getAttribute("data-slot-act");
        const slotIdx = Number(b.getAttribute("data-slot-idx"));
        if (act === "swap") {
          swapKeys(fromSwId, keyIndex, toSwId, slotIdx);
        } else {
          executeMoveKey(fromSwId, keyIndex, toSwId, act, slotIdx);
        }
        closeModal();
      })
    );
  }

  /* ==================== RENDERING ==================== */

  function renderPlanAdditions() {
    if (!planAdditionsLayerEl) return;
    planAdditionsLayerEl.innerHTML = "";

    // Mask deleted fixture №23 baked into plan_top_view_clean.png
    planAdditionsLayerEl.appendChild(
      createSvgEl("rect", {
        x: 490,
        y: 1849,
        width: 48,
        height: 52,
        fill: "#ffffff"
      })
    );
    [
      { x: 842, y: 1664, w: 62, h: 46 },
      { x: 862, y: 2091, w: 60, h: 46 }
    ].forEach((m) => {
      planAdditionsLayerEl.appendChild(
        createSvgEl("rect", { x: m.x, y: m.y, width: m.w, height: m.h, fill: "#ffffff" })
      );
    });
    [1690, 2138].forEach((wy) => {
      planAdditionsLayerEl.appendChild(
        createSvgEl("line", { x1: 954, y1: wy, x2: 926, y2: wy, stroke: "#ea580c", "stroke-width": 3 })
      );
    });

    const mirrorFx = fixturesById.get(39);
    if (mirrorFx && mirrorFx.shape && mirrorFx.shape.kind === "mirror") {
      const ms = mirrorFx.shape;
      planAdditionsLayerEl.appendChild(
        createSvgEl("rect", {
          x: ms.x - 3,
          y: ms.y - 3,
          width: ms.w + 6,
          height: ms.h + 6,
          rx: (ms.rx || 5) + 2,
          fill: "none",
          stroke: "#38bdf8",
          "stroke-width": 1.6,
          "stroke-dasharray": "4 3"
        })
      );
    }

    const ventFx = fixturesById.get(40);
    if (ventFx && ventFx.shape && ventFx.shape.kind === "vent") {
      const vs = ventFx.shape;
      const box = 42;
      const bx = vs.cx - box / 2;
      const by = vs.cy - box / 2;
      planAdditionsLayerEl.appendChild(
        createSvgEl("rect", {
          x: bx,
          y: by,
          width: box,
          height: box,
          rx: 6,
          fill: "#ecfeff",
          stroke: "#0891b2",
          "stroke-width": 2
        })
      );
      planAdditionsLayerEl.appendChild(
        createSvgEl("line", {
          x1: bx + 4,
          y1: by + 4,
          x2: bx + box - 4,
          y2: by + box - 4,
          stroke: "#06b6d4",
          "stroke-width": 1.8,
          opacity: 0.75
        })
      );
      planAdditionsLayerEl.appendChild(
        createSvgEl("line", {
          x1: bx + box - 4,
          y1: by + 4,
          x2: bx + 4,
          y2: by + box - 4,
          stroke: "#06b6d4",
          "stroke-width": 1.8,
          opacity: 0.75
        })
      );
      const vLabel = createSvgEl("text", {
        x: vs.cx,
        y: by + box + 10,
        "text-anchor": "middle",
        fill: "#0e7490",
        "font-size": 9,
        "font-weight": 800
      });
      vLabel.textContent = "ВЕНТ.";
      planAdditionsLayerEl.appendChild(vLabel);
    }

    // Architectural mm dimension lines & mounting height tags (toggled by 📏 Размеры (мм))
    const mounting = window.LIGHTING_MOUNTING;
    if (state.showDims && mounting) {
      const dimsGroup = createSvgEl("g", {
        id: "dims-overlay-group",
        "pointer-events": "none"
      });

      (mounting.dimensionLines || []).forEach((d) => {
        const isHoriz = Math.abs(d.y1 - d.y2) < 4;
        const extColor = "#64748b";
        const dimColor = "#1e293b";

        if (isHoriz) {
          if (d.ext1) {
            dimsGroup.appendChild(
              createSvgEl("line", {
                x1: d.x1,
                y1: d.ext1,
                x2: d.x1,
                y2: d.y1 + (d.y1 < d.ext1 ? -5 : 5),
                stroke: extColor,
                "stroke-width": 1.3,
                "stroke-dasharray": "3 3",
                opacity: 0.78
              })
            );
          }
          if (d.ext2) {
            dimsGroup.appendChild(
              createSvgEl("line", {
                x1: d.x2,
                y1: d.ext2,
                x2: d.x2,
                y2: d.y2 + (d.y2 < d.ext2 ? -5 : 5),
                stroke: extColor,
                "stroke-width": 1.3,
                "stroke-dasharray": "3 3",
                opacity: 0.78
              })
            );
          }
        } else {
          if (d.ext1) {
            dimsGroup.appendChild(
              createSvgEl("line", {
                x1: d.ext1,
                y1: d.y1,
                x2: d.x1 + (d.x1 < d.ext1 ? -5 : 5),
                y2: d.y1,
                stroke: extColor,
                "stroke-width": 1.3,
                "stroke-dasharray": "3 3",
                opacity: 0.78
              })
            );
          }
          if (d.ext2) {
            dimsGroup.appendChild(
              createSvgEl("line", {
                x1: d.ext2,
                y1: d.y2,
                x2: d.x2 + (d.x2 < d.ext2 ? -5 : 5),
                y2: d.y2,
                stroke: extColor,
                "stroke-width": 1.3,
                "stroke-dasharray": "3 3",
                opacity: 0.78
              })
            );
          }
        }

        dimsGroup.appendChild(
          createSvgEl("line", {
            x1: d.x1,
            y1: d.y1,
            x2: d.x2,
            y2: d.y2,
            stroke: dimColor,
            "stroke-width": 1.8,
            opacity: 0.88
          })
        );
        dimsGroup.appendChild(
          createSvgEl("line", {
            x1: d.x1 - 5,
            y1: d.y1 + 5,
            x2: d.x1 + 5,
            y2: d.y1 - 5,
            stroke: dimColor,
            "stroke-width": 2.1
          })
        );
        dimsGroup.appendChild(
          createSvgEl("line", {
            x1: d.x2 - 5,
            y1: d.y2 + 5,
            x2: d.x2 + 5,
            y2: d.y2 - 5,
            stroke: dimColor,
            "stroke-width": 2.1
          })
        );

        const labelText = String(d.label || "");
        const mx = (d.x1 + d.x2) / 2;
        const my = (d.y1 + d.y2) / 2;
        const pillW = Math.max(38, labelText.length * 7.8 + 12);
        const pillH = 18;
        const lx = (isHoriz
          ? mx - pillW / 2
          : d.labelSide === "right"
            ? mx + 7
            : mx - pillW - 7) + (d.dx || 0);
        const ly = (isHoriz ? my - 21 : my - pillH / 2) + (d.dy || 0);

        dimsGroup.appendChild(
          createSvgEl("rect", {
            x: lx.toFixed(1),
            y: ly.toFixed(1),
            width: pillW.toFixed(1),
            height: pillH,
            rx: 4,
            fill: "rgba(255, 255, 255, 0.92)",
            stroke: "#cbd5e1",
            "stroke-width": 1
          })
        );
        const txt = createSvgEl("text", {
          x: (lx + pillW / 2).toFixed(1),
          y: (ly + 12.8).toFixed(1),
          "text-anchor": "middle",
          fill: "#0f172a",
          "font-size": 12,
          "font-weight": 800
        });
        txt.textContent = labelText;
        dimsGroup.appendChild(txt);
      });

      const drawHeightTag = (cx, cy, label, isSwitch) => {
        const w = Math.max(46, label.length * 7.2 + 10);
        const h = 16;
        const rx = cx - w / 2;
        const ry = cy - h / 2;
        dimsGroup.appendChild(
          createSvgEl("rect", {
            x: rx.toFixed(1),
            y: ry.toFixed(1),
            width: w.toFixed(1),
            height: h,
            rx: 4,
            fill: isSwitch ? "#fff7ed" : "#fefce8",
            stroke: isSwitch ? "#fb923c" : "#eab308",
            "stroke-width": 1.1,
            opacity: 0.94
          })
        );
        const t = createSvgEl("text", {
          x: cx.toFixed(1),
          y: (ry + 11.5).toFixed(1),
          "text-anchor": "middle",
          fill: isSwitch ? "#c2410c" : "#854d0e",
          "font-size": 10.5,
          "font-weight": 800
        });
        t.textContent = label;
        dimsGroup.appendChild(t);
      };

      state.switches.forEach((sw) => {
        const swInfo = mounting.switches && mounting.switches[sw.id];
        if (swInfo && swInfo.heightLabel) {
          drawHeightTag(sw.x, sw.y + 28, swInfo.heightLabel, true);
        }
      });

      DATA.fixtures.forEach((f) => {
        const fxInfo = mounting.fixtures && mounting.fixtures[String(f.id)];
        if (fxInfo && fxInfo.heightLabel && fxInfo.heightLabel !== "потолок") {
          if (f.id === 39 && f.shape && f.shape.kind === "mirror") {
            drawHeightTag(f.shape.x - 30, f.shape.y + f.shape.h / 2, fxInfo.heightLabel, false);
          } else {
            drawHeightTag(f.cx, f.cy - f.r - 12, fxInfo.heightLabel, false);
          }
        }
      });

      planAdditionsLayerEl.appendChild(dimsGroup);
    }
  }

  function renderFixturesGlow() {
    glowLayerEl.innerHTML = "";

    DATA.fixtures.forEach((f) => {
      const activeGroups = getFixtureActiveGroups(f.id);
      if (!activeGroups.length) return;

      // Combine brightness and custom color from active groups
      const maxBri = Math.max(...activeGroups.map((g) => ensureGroupSetting(g.id).brightness || 100));
      const briFactor = Math.max(0.22, maxBri / 100);
      const customColorGroup = activeGroups.find((g) => !!ensureGroupSetting(g.id).color);
      const customColor = customColorGroup ? ensureGroupSetting(customColorGroup.id).color : null;
      const s = f.shape;

      if (s.kind === "poly") {
        glowLayerEl.appendChild(
          createSvgEl("polygon", {
            points: formatPts(s.pts),
            fill: customColor ? hexToRgba(customColor, 0.34 * briFactor) : `rgba(253, 224, 71, ${(0.36 * briFactor).toFixed(2)})`,
            stroke: customColor || "#f59e0b",
            "stroke-width": 5,
            "stroke-linejoin": "round",
            opacity: briFactor,
            filter: customColor ? "url(#glow-rgb)" : "url(#glow-warm)"
          })
        );
      } else if (s.kind === "track_v" || s.kind === "track_h") {
        glowLayerEl.appendChild(
          createSvgEl("polygon", {
            points: formatPts(s.pts),
            fill: `rgba(254, 249, 195, ${(0.18 * briFactor).toFixed(2)})`,
            stroke: "#f59e0b",
            "stroke-width": 4,
            "stroke-linejoin": "round"
          })
        );
        const [tl, tr, br, bl] = s.pts;
        const ts = [0.24, 0.5, 0.76];
        s.circuits.forEach((gid, idx) => {
          if (!isGroupOn(gid)) return;
          const gs = ensureGroupSetting(gid);
          const cf = Math.max(0.25, gs.brightness / 100);
          const col = gs.color || CIRCUIT_COLORS[idx];
          const t = ts[idx];
          const p1 = s.kind === "track_v" ? lerpPt(tl, tr, t) : lerpPt(tl, bl, t);
          const p2 = s.kind === "track_v" ? lerpPt(bl, br, t) : lerpPt(tr, br, t);
          glowLayerEl.appendChild(
            createSvgEl("line", {
              x1: p1[0].toFixed(1),
              y1: p1[1].toFixed(1),
              x2: p2[0].toFixed(1),
              y2: p2[1].toFixed(1),
              stroke: col,
              "stroke-width": 11,
              "stroke-linecap": "round",
              opacity: (0.94 * cf).toFixed(2),
              filter: "url(#glow-accent)"
            })
          );
        });
      } else if (s.kind === "line") {
        glowLayerEl.appendChild(
          createSvgEl("line", {
            x1: s.x1,
            y1: s.y1,
            x2: s.x2,
            y2: s.y2,
            stroke: customColor || "#fde047",
            "stroke-width": s.width || 18,
            "stroke-linecap": "round",
            opacity: (0.86 * briFactor).toFixed(2),
            filter: customColor ? "url(#glow-rgb)" : "url(#glow-warm)"
          })
        );
      } else if (s.kind === "perimeter") {
        glowLayerEl.appendChild(
          createSvgEl("polygon", {
            points: formatPts(s.loop),
            fill: "none",
            stroke: customColor || "#fde047",
            "stroke-width": 12,
            "stroke-linejoin": "round",
            opacity: (0.82 * briFactor).toFixed(2),
            filter: customColor ? "url(#glow-rgb)" : "url(#glow-warm)"
          })
        );
        glowLayerEl.appendChild(
          createSvgEl("polygon", {
            points: formatPts(s.pts),
            fill: customColor ? hexToRgba(customColor, 0.34 * briFactor) : `rgba(253, 224, 71, ${(0.34 * briFactor).toFixed(2)})`,
            stroke: customColor || "#f59e0b",
            "stroke-width": 4,
            filter: "url(#glow-warm)"
          })
        );
      } else if (s.kind === "curtain") {
        glowLayerEl.appendChild(
          createSvgEl("line", {
            x1: s.x1,
            y1: s.y1,
            x2: s.x2,
            y2: s.y2,
            stroke: customColor || "#fde047",
            "stroke-width": 14,
            "stroke-linecap": "round",
            opacity: (0.8 * briFactor).toFixed(2),
            filter: customColor ? "url(#glow-rgb)" : "url(#glow-warm)"
          })
        );
        glowLayerEl.appendChild(
          createSvgEl("circle", {
            cx: s.sx,
            cy: s.sy,
            r: 22,
            fill: customColor ? hexToRgba(customColor, 0.45 * briFactor) : `rgba(250, 204, 21, ${(0.45 * briFactor).toFixed(2)})`,
            stroke: customColor || "#f59e0b",
            "stroke-width": 3,
            filter: "url(#glow-warm)"
          })
        );
      } else if (s.kind === "line_icon") {
        glowLayerEl.appendChild(
          createSvgEl("line", {
            x1: s.x1,
            y1: s.y1,
            x2: s.x2,
            y2: s.y2,
            stroke: customColor || "#fde047",
            "stroke-width": 12,
            "stroke-linecap": "round",
            opacity: (0.82 * briFactor).toFixed(2),
            filter: "url(#glow-warm)"
          })
        );
        glowLayerEl.appendChild(
          createSvgEl("circle", {
            cx: s.sx,
            cy: s.sy,
            r: 24,
            fill: customColor ? hexToRgba(customColor, 0.48 * briFactor) : `rgba(250, 204, 21, ${(0.48 * briFactor).toFixed(2)})`,
            stroke: customColor || "#f59e0b",
            "stroke-width": 3,
            filter: "url(#glow-warm)"
          })
        );
      } else if (s.kind === "rgb_spot") {
        const col = customColor || "#ff3b5c";
        glowLayerEl.appendChild(
          createSvgEl("circle", {
            cx: s.sx,
            cy: s.sy,
            r: s.sr + 10,
            fill: hexToRgba(col, 0.44 * briFactor),
            stroke: col,
            "stroke-width": 6,
            filter: "url(#glow-rgb)"
          })
        );
      } else if (s.kind === "mirror") {
        const col = customColor || "#38bdf8";
        glowLayerEl.appendChild(
          createSvgEl("rect", {
            x: s.x - 6,
            y: s.y - 5,
            width: s.w + 12,
            height: s.h + 10,
            rx: (s.rx || 4) + 3,
            fill: hexToRgba(col, 0.34 * briFactor),
            stroke: col,
            "stroke-width": 4,
            filter: customColor ? "url(#glow-rgb)" : "url(#glow-warm)"
          })
        );
      } else if (s.kind === "vent") {
        const sz = s.size || 32;
        glowLayerEl.appendChild(
          createSvgEl("rect", {
            x: s.cx - sz / 2 - 6,
            y: s.cy - sz / 2 - 6,
            width: sz + 12,
            height: sz + 12,
            rx: 8,
            fill: "rgba(6, 182, 212, 0.32)",
            stroke: "#0891b2",
            "stroke-width": 4,
            filter: "url(#glow-warm)"
          })
        );
      } else {
        const defaultFill = s.kind === "warm_sconce" ? `rgba(251, 146, 60, ${(0.52 * briFactor).toFixed(2)})` : `rgba(253, 224, 71, ${(0.5 * briFactor).toFixed(2)})`;
        const defaultEdge = s.kind === "warm_sconce" ? "#ea580c" : "#f59e0b";
        glowLayerEl.appendChild(
          createSvgEl("circle", {
            cx: s.sx,
            cy: s.sy,
            r: Math.max(s.sr || 22, f.r + 7),
            fill: customColor ? hexToRgba(customColor, 0.5 * briFactor) : defaultFill,
            stroke: customColor || defaultEdge,
            "stroke-width": 4,
            filter: customColor ? "url(#glow-rgb)" : "url(#glow-warm)"
          })
        );
      }
    });
  }

  function renderTempLinks() {
    linksLayerEl.innerHTML = "";

    const activeSwId = state.hoveredSwitchId || state.selectedSwitchId;
    if (activeSwId) {
      const sw = getSwitchById(activeSwId);
      if (!sw) return;
      if (isMasterSwitch(sw)) {
        const masterPowerOn = isMasterPowerActive();
        const stroke = masterPowerOn ? "#dc2626" : "#f59e0b";
        DATA.fixtures
          .filter((f) => !f.isNonLight)
          .forEach((f) => {
          const ring = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          ring.setAttribute("cx", f.cx);
          ring.setAttribute("cy", f.cy);
          ring.setAttribute("r", f.r + 5);
          ring.setAttribute("fill", "none");
          ring.setAttribute("stroke", stroke);
          ring.setAttribute("stroke-width", "2.2");
          ring.setAttribute("stroke-dasharray", "4 3");
          ring.setAttribute("opacity", "0.82");
          linksLayerEl.appendChild(ring);
        });
        return;
      }
      getSwitchFixtures(sw).forEach((fid) => {
        const f = fixturesById.get(fid);
        if (!f) return;
        drawTempCurve(sw.x, sw.y, f.cx, f.cy, f.r, "#2563eb");
      });
      return;
    }

    if (state.selectedFixtureId) {
      const f = fixturesById.get(state.selectedFixtureId);
      if (!f) return;
      getSwitchesForFixture(f.id).forEach((sw) => {
        drawTempCurve(sw.x, sw.y, f.cx, f.cy, f.r, "#16a34a");
      });
    }
  }

  function drawTempCurve(x1, y1, x2, y2, r, color) {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const offset = Math.min(46, len * 0.14);
    const cxCtrl = mx - (dy / len) * offset;
    const cyCtrl = my + (dx / len) * offset;

    linksLayerEl.appendChild(
      createSvgEl("path", {
        d: `M ${x1} ${y1} Q ${cxCtrl.toFixed(1)} ${cyCtrl.toFixed(1)} ${x2} ${y2}`,
        fill: "none",
        stroke: color,
        "stroke-width": 3.5,
        "stroke-dasharray": "11 7",
        "stroke-linecap": "round",
        opacity: 0.85
      })
    );
    linksLayerEl.appendChild(
      createSvgEl("circle", {
        cx: x2,
        cy: y2,
        r: r + 7,
        fill: "none",
        stroke: color,
        "stroke-width": 3,
        "stroke-dasharray": "7 5",
        opacity: 0.9
      })
    );
  }

  function getFixturePlanNum(fid) {
    const fc = window.LIGHTING_MOUNTING && window.LIGHTING_MOUNTING.fixtureChannel;
    return (fc && fc[String(fid)]) || String(fid);
  }

  function getSwitchChannelInfo(swId) {
    const sc = window.LIGHTING_MOUNTING && window.LIGHTING_MOUNTING.switchChannel;
    return (sc && sc[swId]) || null;
  }

  function getSwitchFaceLabel(swId) {
    const info = getSwitchChannelInfo(swId);
    return (info && info.faceLabel) || swId;
  }

  function getKeyPlanNum(swId, idx, fallbackKey) {
    const info = getSwitchChannelInfo(swId);
    if (info && Array.isArray(info.keyNums) && info.keyNums[idx]) {
      return info.keyNums[idx];
    }
    return String(fallbackKey || idx + 1);
  }

  function getSwitchKeyLabels(sw) {
    if (!sw) return [];
    if (isMasterSwitch(sw)) return ["М"];
    const info = getSwitchChannelInfo(sw.id);
    const keys = getEffectiveKeys(sw);
    const dt = getEffectiveDeviceType(sw);
    const totalSlots = Math.max(keys.length, dt.maxRecommendedKeys || 1);
    const labels = [];
    for (let i = 0; i < totalSlots; i++) {
      const k = keys[i];
      if (k && isEmptyKey(k)) {
        labels.push("");
        continue;
      }
      if (info && Array.isArray(info.keyNums) && info.keyNums[i]) {
        labels.push(String(info.keyNums[i]));
      } else if (k) {
        const fxNums = [...new Set(getKeyFixtures(k).map((fid) => getFixturePlanNum(fid)))];
        labels.push(fxNums.length ? fxNums.join("+") : String(k.key || i + 1));
      } else {
        labels.push("");
      }
    }
    return labels;
  }

  function renderFixtureHits() {
    fixtureHitsLayerEl.innerHTML = "";
    DATA.fixtures.forEach((f) => {
      const planNum = getFixturePlanNum(f.id);
      const isMultiTrack = planNum.indexOf(",") !== -1;
      const activeGroups = getFixtureActiveGroups(f.id);
      const isOn = activeGroups.length > 0;
      const customColorGroup = activeGroups.find((g) => !!ensureGroupSetting(g.id).color);
      const customColor = customColorGroup ? ensureGroupSetting(customColorGroup.id).color : null;

      let strokeOff = "#1d4ed8";
      let textOff = "#1e3a8a";
      if (f.isNonLight) {
        strokeOff = "#0891b2";
        textOff = "#155e75";
      } else if (f.id >= 30) {
        strokeOff = "#7c3aed";
        textOff = "#4c1d95";
      } else if (f.id === 28 || f.id === 29) {
        strokeOff = "#ea580c";
        textOff = "#9a3412";
      }

      let fill = "#ffffff";
      let stroke = strokeOff;
      let strokeWidth = 2.2;
      let textFill = textOff;
      if (isOn) {
        if (f.isNonLight) {
          fill = "#cffafe";
          stroke = "#0891b2";
          strokeWidth = 3.2;
          textFill = "#0e7490";
        } else if (customColor) {
          fill = "#ffffff";
          stroke = customColor;
          strokeWidth = 3.6;
          textFill = "#0f172a";
        } else {
          fill = "#fef08a";
          stroke = "#ca8a04";
          strokeWidth = 3;
          textFill = "#713f12";
        }
      }

      const hitGroup = createSvgEl("g", {
        class: `fixture-hit ${isOn ? "is-on" : ""} ${state.selectedFixtureId === f.id ? "is-selected" : ""}`,
        "data-fixture-id": f.id
      });
      const titleEl = createSvgEl("title", {});
      titleEl.textContent = f.isNonLight
        ? `Клавиша/точка ${planNum} (${f.room}, не свет) — ${f.type}`
        : `Клавиша/свет ${planNum} (${f.room}) — ${f.type}`;
      hitGroup.appendChild(titleEl);

      if (isMultiTrack) {
        const pillW = Math.round(planNum.length * 8.5 + 16);
        const pillH = 28;
        hitGroup.appendChild(
          createSvgEl("circle", {
            cx: f.cx,
            cy: f.cy,
            r: f.r + 2,
            fill: "#ffffff",
            stroke: "none"
          })
        );
        hitGroup.appendChild(
          createSvgEl("rect", {
            class: "fixture-badge-circle",
            x: f.cx - pillW / 2,
            y: f.cy - pillH / 2,
            width: pillW,
            height: pillH,
            rx: 12,
            fill,
            stroke,
            "stroke-width": strokeWidth
          })
        );
        const numText = createSvgEl("text", {
          class: "fixture-badge-num",
          x: f.cx,
          y: f.cy,
          "text-anchor": "middle",
          "dominant-baseline": "central",
          fill: textFill,
          "font-size": 14
        });
        numText.textContent = planNum;
        hitGroup.appendChild(numText);
      } else if (f.shape && f.shape.kind === "mirror") {
        const ms = f.shape;
        const mFill = isOn ? (customColor ? "#ffffff" : "#fef08a") : "#e0f2fe";
        const mStroke = isOn ? (customColor || "#ca8a04") : "#0284c7";
        const mText = isOn ? "#713f12" : "#0c4a6e";
        hitGroup.appendChild(
          createSvgEl("rect", {
            class: "fixture-badge-circle",
            x: ms.x,
            y: ms.y,
            width: ms.w,
            height: ms.h,
            rx: ms.rx || 5,
            fill: mFill,
            stroke: mStroke,
            "stroke-width": isOn ? 3.2 : 2.2
          })
        );
        const numText = createSvgEl("text", {
          class: "fixture-badge-num",
          x: ms.x + ms.w / 2,
          y: ms.y + ms.h / 2,
          "text-anchor": "middle",
          "dominant-baseline": "central",
          fill: mText,
          "font-size": 15
        });
        numText.textContent = planNum;
        hitGroup.appendChild(numText);
      } else {
        const badgeR = Math.max(f.r + 1.5, 16);
        hitGroup.appendChild(
          createSvgEl("circle", {
            class: "fixture-badge-circle",
            cx: f.cx,
            cy: f.cy,
            r: badgeR,
            fill,
            stroke,
            "stroke-width": strokeWidth
          })
        );
        const numText = createSvgEl("text", {
          class: "fixture-badge-num",
          x: f.cx,
          y: f.cy,
          "text-anchor": "middle",
          "dominant-baseline": "central",
          fill: textFill,
          "font-size": Math.round(badgeR * 0.96)
        });
        numText.textContent = planNum;
        hitGroup.appendChild(numText);
      }

      bindFixtureHitEvents(hitGroup, f);
      fixtureHitsLayerEl.appendChild(hitGroup);

      // Tiny comment indicator ONLY if this fixture has a comment
      const cmt = (state.fixtureComments[f.id] || "").trim();
      if (cmt) {
        const bx = f.cx + f.r * 0.78;
        const by = f.cy - f.r * 0.78;
        const g = createSvgEl("g", { class: "fixture-comment-badge" });
        g.appendChild(
          createSvgEl("circle", {
            cx: bx,
            cy: by,
            r: 9.5,
            fill: "#16a34a",
            stroke: "#ffffff",
            "stroke-width": 2
          })
        );
        const t = createSvgEl("text", {
          x: bx,
          y: by,
          "text-anchor": "middle",
          "dominant-baseline": "central",
          fill: "#ffffff",
          "font-size": 10.5,
          "font-weight": "bold"
        });
        t.textContent = "✎";
        g.appendChild(t);
        fixtureHitsLayerEl.appendChild(g);
      }
    });
  }

  function renderSwitchFaceplateHtml(deviceTypeId, opts) {
    const o = opts || {};
    const sizeCls = o.sizeClass ? ` ${o.sizeClass}` : "";
    const keyStates = o.keyStates || [false, false, false];
    const k0On = !!keyStates[0];
    const k1On = !!keyStates[1];
    const k2On = !!keyStates[2];
    const anyOn = k0On || k1On || k2On;
    const keyCount = typeof o.keyCount === "number" ? o.keyCount : 2;
    const bri = typeof o.brightness === "number" ? o.brightness : 75;
    const rgbColor = o.rgbColor || "#ff3b5c";
    const titles = o.slotTitles || ["", "", ""];
    const interactive = !!o.interactiveSlots;
    const slotEmpty = Array.isArray(o.slotEmpty) ? o.slotEmpty : [keyCount < 1, keyCount < 2, keyCount < 3];
    const kl = o.sizeClass === "is-legend" ? [] : (Array.isArray(o.keyLabels) ? o.keyLabels : []);

    let inner = "";
    if (deviceTypeId === "rocker_1") {
      const n0 = kl[0] ? `<span class="sw-key-num">${escapeHtml(kl[0])}</span>` : "";
      inner = `<div class="sw-mech-rocker1 ${k0On ? "is-key-on" : ""}">${n0}<span class="sw-led"></span></div>`;
    } else if (deviceTypeId === "rocker_2") {
      const s0 = interactive ? ` data-key-slot="0"${titles[0] ? ` title="${escapeHtml(titles[0])}"` : ""}` : "";
      const s1 = interactive ? ` data-key-slot="1"${titles[1] ? ` title="${escapeHtml(titles[1])}"` : ""}` : "";
      const n0 = kl[0] ? `<span class="sw-key-num${kl[0].length >= 2 ? " is-2ch" : ""}">${escapeHtml(kl[0])}</span>` : "";
      const n1 = kl[1] ? `<span class="sw-key-num${kl[1].length >= 2 ? " is-2ch" : ""}">${escapeHtml(kl[1])}</span>` : "";
      inner = `
        <div class="sw-mech-rocker2">
          <div class="sw-half-key ${k0On ? "is-key-on" : ""} ${slotEmpty[0] ? "is-empty-slot" : ""}"${s0}>${n0}<span class="sw-led"></span></div>
          <div class="sw-half-key ${k1On ? "is-key-on" : ""} ${slotEmpty[1] ? "is-empty-slot" : ""}"${s1}>${n1}<span class="sw-led"></span></div>
        </div>
      `;
    } else if (deviceTypeId === "rocker_3") {
      const s0 = interactive ? ` data-key-slot="0"${titles[0] ? ` title="${escapeHtml(titles[0])}"` : ""}` : "";
      const s1 = interactive ? ` data-key-slot="1"${titles[1] ? ` title="${escapeHtml(titles[1])}"` : ""}` : "";
      const s2 = interactive ? ` data-key-slot="2"${titles[2] ? ` title="${escapeHtml(titles[2])}"` : ""}` : "";
      const n0 = kl[0] ? `<span class="sw-key-num">${escapeHtml(kl[0])}</span>` : "";
      const n1 = kl[1] ? `<span class="sw-key-num">${escapeHtml(kl[1])}</span>` : "";
      const n2 = kl[2] ? `<span class="sw-key-num">${escapeHtml(kl[2])}</span>` : "";
      inner = `
        <div class="sw-mech-rocker3">
          <div class="sw-third-key ${k0On ? "is-key-on" : ""} ${slotEmpty[0] ? "is-empty-slot" : ""}"${s0}>${n0}<span class="sw-led"></span></div>
          <div class="sw-third-key ${k1On ? "is-key-on" : ""} ${slotEmpty[1] ? "is-empty-slot" : ""}"${s1}>${n1}<span class="sw-led"></span></div>
          <div class="sw-third-key ${k2On ? "is-key-on" : ""} ${slotEmpty[2] ? "is-empty-slot" : ""}"${s2}>${n2}<span class="sw-led"></span></div>
        </div>
      `;
    } else if (deviceTypeId === "button_1") {
      const capCls = kl[0] && kl[0].length >= 3 ? "sw-push-cap is-pill-cap" : "sw-push-cap";
      const capInner = kl[0]
        ? `<span class="sw-key-num is-btn1-num">${escapeHtml(kl[0])}</span>`
        : `<span class="sw-push-dot"></span>`;
      inner = `
        <div class="sw-mech-button1 ${k0On ? "is-key-on" : ""}">
          <span class="${capCls}">${capInner}</span>
        </div>
      `;
    } else if (deviceTypeId === "button_2") {
      const s0 = interactive ? ` data-key-slot="0"${titles[0] ? ` title="${escapeHtml(titles[0])}"` : ""}` : "";
      const s1 = interactive ? ` data-key-slot="1"${titles[1] ? ` title="${escapeHtml(titles[1])}"` : ""}` : "";
      const n0 = kl[0] ? `<span class="sw-key-num is-btn2-num">${escapeHtml(kl[0])}</span>` : "";
      const n1 = kl[1] ? `<span class="sw-key-num is-btn2-num">${escapeHtml(kl[1])}</span>` : "";
      inner = `
        <div class="sw-mech-button2">
          <div class="sw-btn-half ${k0On ? "is-key-on" : ""} ${slotEmpty[0] ? "is-empty-slot" : ""}"${s0}><span class="sw-push-cap-sm">${n0}</span></div>
          <div class="sw-btn-half ${k1On ? "is-key-on" : ""} ${slotEmpty[1] ? "is-empty-slot" : ""}"${s1}><span class="sw-push-cap-sm">${n1}</span></div>
        </div>
      `;
    } else if (deviceTypeId === "dimmer") {
      const deg = -125 + ((Math.max(15, Math.min(100, bri)) - 15) / 85) * 250;
      const arcCol = anyOn ? "#d97706" : "#94a3b8";
      const knobFill = anyOn ? "#fef3c7" : "#ffffff";
      const knobStroke = anyOn ? "#b45309" : "#475569";
      const tickStroke = anyOn ? "#b45309" : "#334155";
      const isCompact = !!o.sizeClass;
      const cx = 21;
      const cy = 21;
      const arcR = isCompact ? 15 : 16.2;
      const knobR = isCompact ? 10 : 11.4;
      const pt = (ang) => {
        const rad = ((ang - 90) * Math.PI) / 180;
        return `${(cx + arcR * Math.cos(rad)).toFixed(1)} ${(cy + arcR * Math.sin(rad)).toFixed(1)}`;
      };
      const tickY2 = kl[0] ? (cy - knobR + 3.6).toFixed(1) : String(cy);
      const labelSvg = kl[0]
        ? `<text x="${cx}" y="21.5" text-anchor="middle" dominant-baseline="central" font-size="${isCompact ? 8.5 : 11.5}" font-weight="900" fill="#0f172a">${escapeHtml(kl[0])}</text>`
        : "";
      inner = `
        <svg class="sw-face-svg" viewBox="0 0 42 42" aria-hidden="true">
          <path d="M ${pt(-125)} A ${arcR} ${arcR} 0 1 1 ${pt(125)}" fill="none" stroke="${arcCol}" stroke-width="2.6" stroke-linecap="round"/>
          <circle cx="${cx}" cy="${cy}" r="${knobR}" fill="${knobFill}" stroke="${knobStroke}" stroke-width="2.1"/>
          <line x1="${cx}" y1="${(cy - knobR + 0.5).toFixed(1)}" x2="${cx}" y2="${tickY2}" stroke="${tickStroke}" stroke-width="${kl[0] ? 2.6 : 2.3}" stroke-linecap="round" transform="rotate(${deg.toFixed(0)} ${cx} ${cy})"/>
          ${labelSvg}
        </svg>
      `;
    } else if (deviceTypeId === "dimmer_rgb") {
      const deg = -125 + ((Math.max(15, Math.min(100, bri)) - 15) / 85) * 250;
      const isCompact = !!o.sizeClass;
      const cx = 21;
      const cy = 21;
      const arcR = isCompact ? 15 : 16.2;
      const knobR = isCompact ? 10 : 11.4;
      const pt = (ang) => {
        const rad = ((ang - 90) * Math.PI) / 180;
        return `${(cx + arcR * Math.cos(rad)).toFixed(1)} ${(cy + arcR * Math.sin(rad)).toFixed(1)}`;
      };
      const op = anyOn ? 1 : 0.65;
      const knobStroke = anyOn ? rgbColor : "#cbd5e1";
      const knobFill = anyOn ? "#ffffff" : "#e2e8f0";
      const tickY2 = kl[0] ? (cy - knobR + 3.6).toFixed(1) : (cy - 1.5).toFixed(1);
      const centerGraphic = kl[0]
        ? `<text x="${cx}" y="21.5" text-anchor="middle" dominant-baseline="central" font-size="${isCompact ? 8.5 : 11.5}" font-weight="900" fill="#0f172a">${escapeHtml(kl[0])}</text>`
        : `<circle cx="${cx}" cy="${cy}" r="${isCompact ? 3.2 : 2.6}" fill="${anyOn ? rgbColor : "#64748b"}"/>`;
      inner = `
        <svg class="sw-face-svg" viewBox="0 0 42 42" aria-hidden="true">
          <g opacity="${op}" fill="none" stroke-width="${isCompact ? 3 : 2.6}" stroke-linecap="round">
            <path d="M ${pt(-125)} A ${arcR} ${arcR} 0 0 1 ${pt(-42)}" stroke="#fb7185"/>
            <path d="M ${pt(-42)} A ${arcR} ${arcR} 0 0 1 ${pt(42)}" stroke="#34d399"/>
            <path d="M ${pt(42)} A ${arcR} ${arcR} 0 0 1 ${pt(125)}" stroke="#60a5fa"/>
          </g>
          <circle cx="${cx}" cy="${cy}" r="${knobR}" fill="${knobFill}" stroke="${knobStroke}" stroke-width="${anyOn ? 2.4 : 1.8}"/>
          ${centerGraphic}
          <line x1="${cx}" y1="${(cy - knobR + 0.5).toFixed(1)}" x2="${cx}" y2="${tickY2}" stroke="#0f172a" stroke-width="${isCompact ? 2.4 : 2.3}" stroke-linecap="round" transform="rotate(${deg.toFixed(0)} ${cx} ${cy})"/>
        </svg>
      `;
    } else if (deviceTypeId === "master_light") {
      const mLbl = kl[0] || "М";
      inner = `
        <div class="sw-mech-master ${k0On ? "is-key-on" : "is-master-cut"}">
          <span class="sw-key-num is-master-num">${escapeHtml(mLbl)}</span>
          <span class="sw-led"></span>
        </div>
      `;
    }

    return `<div class="sw-frame type-${deviceTypeId}${sizeCls}">${inner}</div>`;
  }

  function renderFloatingLegend() {
    if (!floatingLegendEl) return;
    const legendItems = [
      { id: "rocker_1", label: "1 кл." },
      { id: "rocker_2", label: "2 кл." },
      { id: "rocker_3", label: "3 кл." },
      { id: "button_1", label: "Кнопка" },
      { id: "button_2", label: "2 кн." },
      { id: "dimmer_rgb", label: "RGB" },
      { id: "master_light", label: "Мастер" }
    ];
    floatingLegendEl.innerHTML =
      `<div class="legend-item"><span class="lg-badge lg-off">×</span> Выкл</div>` +
      `<div class="legend-item"><span class="lg-badge lg-on">✓</span> Вкл</div>` +
      legendItems
        .map((item) => {
          const dt = DATA.deviceTypes[item.id];
          const kc = (dt && dt.maxRecommendedKeys) || 2;
          return `<div class="legend-item">${renderSwitchFaceplateHtml(item.id, { sizeClass: "is-legend", keyCount: kc, keyStates: [item.id === "master_light"], brightness: 80 })}<span>${item.label}</span></div>`;
        })
        .join("");
  }

  function renderSwitchMarkers() {
    switchesLayerEl.innerHTML = "";

    state.switches.forEach((sw) => {
      const st = getSwitchStatus(sw);
      const dt = getEffectiveDeviceType(sw);
      const keys = getEffectiveKeys(sw);
      const hasComment = !!(sw.comment && sw.comment.trim());

      const firstActiveKey = keys.find((k) => !isEmptyKey(k));
      const firstTargets = firstActiveKey ? getKeyTargetGroups(firstActiveKey) : [];
      const firstSetting = firstTargets.length ? ensureGroupSetting(firstTargets[0]) : { brightness: 80, color: "#ff3b5c" };

      const el = document.createElement("div");
      el.className = "switch-marker";
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.dataset.switchId = sw.id;
      el.style.left = `${sw.x}px`;
      el.style.top = `${sw.y}px`;
      el.title = `${sw.id} (${dt.fullLabel}) — ${sw.title}\n${sw.doorCheck ? "⚠ " + sw.doorNote : sw.doorNote}`;

      if (st.isOn && !st.isPartial) el.classList.add("is-on");
      if (st.isPartial) el.classList.add("is-partial");
      if (st.isMasterCut) el.classList.add("is-master-cut");
      if (state.selectedSwitchId === sw.id) el.classList.add("is-selected");

      // Realistic square wall mechanism faceplate (key numbers rendered directly on keys)
      const keyLabels = getSwitchKeyLabels(sw);
      const frameHost = document.createElement("div");
      frameHost.innerHTML = renderSwitchFaceplateHtml(dt.id, {
        keyStates: st.keyStates,
        keyCount: keys.length,
        keyLabels,
        slotEmpty: [isEmptyKey(keys[0]), isEmptyKey(keys[1]), isEmptyKey(keys[2])],
        brightness: firstSetting.brightness,
        rgbColor: firstSetting.color || "#ff3b5c",
        interactiveSlots: !isMasterSwitch(sw),
        slotTitles: [
          !isEmptyKey(keys[0]) ? `Клавиша ${keyLabels[0] || 1}: ${keys[0].label}` : "Свободная клавиша 1",
          !isEmptyKey(keys[1]) ? `Клавиша ${keyLabels[1] || 2}: ${keys[1].label}` : "Свободная клавиша 2",
          !isEmptyKey(keys[2]) ? `Клавиша ${keyLabels[2] || 3}: ${keys[2].label}` : "Свободная клавиша 3"
        ]
      });
      const frameEl = frameHost.firstElementChild;

      if (sw.doorCheck) {
        const dot = document.createElement("span");
        dot.className = "sw-door-dot";
        dot.title = sw.doorNote;
        frameEl.appendChild(dot);
      }

      if (hasComment) {
        const cBadge = document.createElement("span");
        cBadge.className = "sw-comment-badge";
        cBadge.textContent = "💬";
        cBadge.title = sw.comment;
        frameEl.appendChild(cBadge);
      }

      let linkHandle = null;
      if (!isMasterSwitch(sw)) {
        linkHandle = document.createElement("span");
        linkHandle.className = "sw-link-handle";
        linkHandle.textContent = "🔗";
        linkHandle.title = `Потяните к точке №1–40, чтобы привязать к ${sw.id}`;
        frameEl.appendChild(linkHandle);
      }

      el.appendChild(frameEl);

      bindSwitchMarkerEvents(el, linkHandle, sw);
      switchesLayerEl.appendChild(el);
    });
  }

  /* ==================== CARD RENDERING (SWITCH & FIXTURE) ==================== */

  function renderDimmerAndRgbPanelHtml(sw) {
    const dt = getEffectiveDeviceType(sw);
    if (!dt.hasDimmer && !dt.hasRgb) return "";

    const keys = getEffectiveKeys(sw);
    const targetGroups = keys.length ? keys.flatMap((k) => getKeyTargetGroups(k)) : [];

    if (!targetGroups.length) {
      return `<div class="pop-note">Привяжите хотя бы один светильник к ${sw.id}, чтобы управлять ${dt.hasRgb ? "диммером и RGB" : "диммером"}.</div>`;
    }

    const primaryGid = targetGroups[0];
    const primarySetting = ensureGroupSetting(primaryGid);
    const activeColor = primarySetting.color || "#ff3b5c";

    const dimmerHtml = `
      <div>
        <div class="rgb-section-title">Яркость регулятора: <strong data-dimmer-label="${sw.id}">${primarySetting.brightness}%</strong></div>
        <div class="rgb-slider-row">
          <input type="range" min="15" max="100" step="5" value="${primarySetting.brightness}" data-dimmer-slider="${sw.id}" aria-label="Яркость регулятора">
        </div>
      </div>
    `;

    let rgbHtml = "";
    if (dt.hasRgb) {
      const swatchesHtml = DATA.rgbPresets
        .map(
          (p) =>
            `<button type="button" class="rgb-swatch ${activeColor.toLowerCase() === p.color.toLowerCase() ? "is-selected" : ""}" style="background:${p.color}" data-rgb-sw="${sw.id}" data-rgb-color="${p.color}" title="${p.name}"></button>`
        )
        .join("");

      const scenesHtml =
        Array.isArray(DATA.rgbScenes) && DATA.rgbScenes.length
          ? `
        <div>
          <div class="rgb-section-title">Быстрые сценарии</div>
          <div class="rgb-scenes">${DATA.rgbScenes
            .map(
              (sc) =>
                `<button type="button" class="rgb-scene-btn ${primarySetting.scene === sc.id && primarySetting.on ? "is-active" : ""}" data-rgb-sw="${sw.id}" data-rgb-scene="${sc.id}"><span class="scene-dot" style="background:${sc.color}"></span>${sc.name}</button>`
            )
            .join("")}</div>
        </div>
      `
          : "";

      rgbHtml = `
        <div>
          <div class="rgb-section-title">Цвет RGB (поворот с нажатием)</div>
          <div class="rgb-swatches">
            ${swatchesHtml}
            <input type="color" class="rgb-color-input" data-rgb-picker="${sw.id}" value="${activeColor}" title="Произвольный цвет">
          </div>
        </div>
        ${scenesHtml}
      `;
    }

    return `<div class="rgb-panel" data-rgb-container="${sw.id}">${dimmerHtml}${rgbHtml}</div>`;
  }

  function renderSwitchCardBodyHtml(sw, inPopover) {
    const st = getSwitchStatus(sw);
    const dt = getEffectiveDeviceType(sw);
    const noteClass = sw.doorCheck ? "pop-note is-door" : "pop-note";
    const prefix = inPopover ? "pop" : "insp";

    const typeSelectId = `${prefix}-sw-type-${sw.id}`;
    const roomSelectId = `${prefix}-sw-room-${sw.id}`;
    const commentId = `${prefix}-sw-comment-${sw.id}`;

    if (isMasterSwitch(sw)) {
      const powerOn = isMasterPowerActive();
      const hwNote = dt.hardwareNote
        ? `<div class="pop-note" style="background:#f5f3ff;border-color:#ddd6fe;color:#5b21b6;">${dt.hardwareNote}</div>`
        : "";
      const miniFaceplate = renderSwitchFaceplateHtml(dt.id, {
        sizeClass: "is-mini",
        keyStates: [powerOn],
        keyCount: 1,
        keyLabels: ["М"]
      });
      const roomOptions = ROOM_ORDER.map(
        (r) => `<option value="${r}" ${sw.room === r ? "selected" : ""}>${r}</option>`
      ).join("");
      const activeRoomGroupsCount = state.groups.filter((g) => isGroupRawOn(g.id)).length;

      return `
        <div class="pop-header">
          <div class="pop-title-wrap">
            <div class="pop-id-line">
              ${miniFaceplate}
              <span class="hw-pill hw-${dt.id}">${dt.shortLabel}</span>
              <span class="pop-room-badge">${sw.room}</span>
            </div>
            <div class="pop-title">${escapeHtml(sw.title)}</div>
          </div>
          ${inPopover ? `<button type="button" class="pop-close" data-close-popover="1" title="Закрыть карточку">✕</button>` : ""}
        </div>
        <div class="${noteClass}">${sw.heightNote}</div>
        ${hwNote}
        ${renderChaseBoxHtml("switch", sw.id)}

        <div class="master-control-box ${powerOn ? "" : "is-master-cut"}">
          <div class="master-status-badge">
            ${
              powerOn
                ? `⚡ Питание всего освещения ВКЛЮЧЕНО (сейчас горит ${st.activeFixtures} из ${DATA.meta.totalFixtures} ламп)`
                : `⚡ МАСТЕР-ВЫКЛЮЧАТЕЛЬ НАЖАТ: все светильники (№1–39) обесточены (вентиляция №40 работает)`
            }
          </div>
          <div class="master-btn-row">
            <button type="button" class="master-toggle-btn ${powerOn ? "" : "is-cut"}" data-toggle-master-light="1">
              ${powerOn ? "⚡ Выключить весь свет (ухожу)" : "⚡ Включить мастер-свет (BM)"}
            </button>
            <button type="button" class="master-reset-rooms-btn" data-reset-room-switches="1" title="Перевести все комнатные клавиши в Выкл (${activeRoomGroupsCount} активн.)">
              Сбросить клавиши (${activeRoomGroupsCount})
            </button>
          </div>
          <div class="master-placement-tip">
            ${
              powerOn
                ? "Нажмите, чтобы перед уходом одним щелчком обесточить все линии света (контактор в щите). Состояния комнатных выключателей сохранятся до возвращения."
                : "Розетки (холодильник, Wi-Fi, автокормушки, автопоилки) и вытяжка санузла №40 остаются под напряжением. Повторное нажатие вернёт свет."
            }
          </div>
          <div class="master-placement-tip">
            <strong>Куда ставить относительно B1:</strong> разместите BM выше <strong>B1</strong> (на высоте ~140–150 см) или внутри/у электрощита, но <strong>не в одной рамке с B1 на 90 см</strong> — иначе в темноте рука будет задевать BM вместо света прихожей.
          </div>
        </div>

        <div class="field-row-inline" style="margin-top:9px;">
          <label class="field-label" for="${roomSelectId}" style="white-space:nowrap;">Помещение:</label>
          <select id="${roomSelectId}" class="field-select" data-change-sw-room="${sw.id}">${roomOptions}</select>
        </div>

        <div class="field-row">
          <label class="field-label" for="${commentId}">💬 Комментарий к мастер-выключателю ${sw.id}:</label>
          <textarea id="${commentId}" class="comment-textarea" data-sw-comment="${sw.id}" placeholder="Например: высота 145 см, с красной индикацией или клавишей под защитной шторкой...">${escapeHtml(sw.comment || "")}</textarea>
        </div>

        <div class="pop-actions">
          <button type="button" class="btn-danger-outline" data-delete-sw="${sw.id}">Удалить ${sw.id}</button>
        </div>
      `;
    }

    const typeOptions = Object.values(DATA.deviceTypes)
      .filter((t) => !t.isMaster)
      .map(
        (t) =>
          `<option value="${t.id}" ${sw.deviceType === t.id ? "selected" : ""}>${t.fullLabel}</option>`
      )
      .join("");

    const roomOptions = ROOM_ORDER.map(
      (r) => `<option value="${r}" ${sw.room === r ? "selected" : ""}>${r}</option>`
    ).join("");

    const keys = getEffectiveKeys(sw);
    const totalSlots = Math.max(keys.length, dt.maxRecommendedKeys);
    const showSlotTag = dt.maxRecommendedKeys >= 2 || keys.length > 1;
    let keysHtml = "";
    if (!keys.length && dt.maxRecommendedKeys < 2) {
      keysHtml = `<div class="pop-note">Нет привязанных точек. Перетяните линию от ${sw.id} к любому номеру 1–40 на плане.</div>`;
    } else {
      const slotRows = [];
      for (let idx = 0; idx < totalSlots; idx++) {
        const k = keys[idx];
        if (!k || isEmptyKey(k)) {
          slotRows.push(`
            <div class="key-row-empty" data-drop-empty-sw="${sw.id}" data-drop-empty-slot="${idx}">
              <span>Клавиша ${idx + 1} свободна — перетащите сюда клавишу или привяжите светильник</span>
              <button type="button" data-start-link-from-sw="${sw.id}">🔗 Привязать</button>
            </div>
          `);
          continue;
        }
        const on = isKeyOn(k);
        const targets = getKeyTargetGroups(k);
        const fx = getKeyFixtures(k)
          .map((n) => `№${n}`)
          .join(", ");
        slotRows.push(`
          <div class="key-row-wrap" draggable="true" data-drag-from-switch="${sw.id}" data-drag-key-index="${idx}" data-drop-key-sw="${sw.id}" data-drop-key-idx="${idx}">
            <button type="button" class="key-row ${on ? "is-on" : ""}" data-toggle-sw-key="${sw.id}" data-toggle-key-idx="${idx}">
              <span class="key-row-main">
                <span class="drag-grip" title="Перетащите на другую клавишу (поменять местами) или на другой выключатель">⠿</span>
                ${showSlotTag ? `<span class="key-slot-tag">Клавиша ${escapeHtml(getKeyPlanNum(sw.id, idx, k.key))}</span>` : ""}
                <span class="key-state-pill">${on ? "✓" : "×"}</span>
                <span class="key-info">
                  <span class="key-label">${escapeHtml(k.label)}</span>
                  <span class="key-meta">Каналы ${targets.join(" + ")} · Светильники: ${fx || "нет"}</span>
                </span>
              </span>
            </button>
            <button type="button" class="key-unbind-btn" data-unbind-sw="${sw.id}" data-unbind-idx="${idx}" title="Отвязать клавишу от ${sw.id}">✕</button>
          </div>
        `);
      }

      keysHtml = `<div class="pop-keys">${slotRows.join("")}</div>`;
    }

    const hasAnyActiveKey = keys.some((k) => !isEmptyKey(k));
    const swapButtonsHtml =
      totalSlots >= 2 && hasAnyActiveKey
        ? totalSlots === 2
          ? `<button type="button" data-swap-own-keys="${sw.id}" data-swap-a="0" data-swap-b="1" title="Поменять левую и правую клавиши местами">⇄ Поменять кл. 1 и 2</button>`
          : `
            <button type="button" data-swap-own-keys="${sw.id}" data-swap-a="0" data-swap-b="1" title="Поменять 1-ю и 2-ю клавиши местами">⇄ Кл. 1↔2</button>
            <button type="button" data-swap-own-keys="${sw.id}" data-swap-a="1" data-swap-b="2" title="Поменять 2-ю и 3-ю клавиши местами">⇄ Кл. 2↔3</button>
          `
        : "";
    const activeKeysCount = keys.filter((k) => !isEmptyKey(k)).length;
    const batchBtns =
      activeKeysCount > 1 || swapButtonsHtml
        ? `
          <div class="pop-actions">
            ${swapButtonsHtml}
            ${activeKeysCount > 1 ? `<button type="button" data-panel-all="${sw.id}" data-val="1">Вкл. все клавиши (${sw.id})</button><button type="button" data-panel-all="${sw.id}" data-val="0">Выкл. все (${sw.id})</button>` : ""}
          </div>
        `
        : "";

    const hwNote = dt.hardwareNote
      ? `<div class="pop-note" style="background:#f5f3ff;border-color:#ddd6fe;color:#5b21b6;">${dt.hardwareNote}</div>`
      : "";

    const firstActiveKey = keys.find((k) => !isEmptyKey(k));
    const firstTargets = firstActiveKey ? getKeyTargetGroups(firstActiveKey) : [];
    const firstSetting = firstTargets.length ? ensureGroupSetting(firstTargets[0]) : { brightness: 80, color: "#ff3b5c" };
    const miniFaceplate = renderSwitchFaceplateHtml(dt.id, {
      sizeClass: "is-mini",
      keyStates: st.keyStates,
      keyCount: keys.length,
      keyLabels: getSwitchKeyLabels(sw),
      slotEmpty: [isEmptyKey(keys[0]), isEmptyKey(keys[1]), isEmptyKey(keys[2])],
      brightness: firstSetting.brightness,
      rgbColor: firstSetting.color || "#ff3b5c"
    });

    return `
      <div class="pop-header">
        <div class="pop-title-wrap">
          <div class="pop-id-line">
            ${miniFaceplate}
            <span class="hw-pill hw-${dt.id}">${dt.shortLabel}</span>
            <span class="pop-room-badge">${sw.room}</span>
          </div>
          <div class="pop-title">${escapeHtml(sw.title)}</div>
        </div>
        ${inPopover ? `<button type="button" class="pop-close" data-close-popover="1" title="Закрыть карточку">✕</button>` : ""}
      </div>
      <div class="${noteClass}">${sw.doorCheck ? "⚠ " + sw.doorNote : sw.doorNote} · ${sw.heightNote}</div>
      ${hwNote}
      ${renderChaseBoxHtml("switch", sw.id)}

      <div class="field-row">
        <label class="field-label" for="${typeSelectId}">Тип механизма на стене:</label>
        <select id="${typeSelectId}" class="field-select" data-change-device-type="${sw.id}">${typeOptions}</select>
      </div>

      <div class="field-row-inline">
        <label class="field-label" for="${roomSelectId}" style="white-space:nowrap;">Помещение:</label>
        <select id="${roomSelectId}" class="field-select" data-change-sw-room="${sw.id}">${roomOptions}</select>
      </div>

      ${keysHtml}
      ${batchBtns}
      ${renderDimmerAndRgbPanelHtml(sw)}

      <div class="field-row" style="margin-top:9px;">
        <label class="field-label" for="${commentId}">💬 Комментарий к выключателю ${sw.id}:</label>
        <textarea id="${commentId}" class="comment-textarea" data-sw-comment="${sw.id}" placeholder="Например: перенести за угол, объединить в 1 рамку, поменять тип...">${escapeHtml(sw.comment || "")}</textarea>
      </div>

      <div class="pop-actions">
        <button type="button" data-start-link-from-sw="${sw.id}">🔗 Привязать светильник</button>
        <button type="button" class="btn-danger-outline" data-delete-sw="${sw.id}">Удалить ${sw.id}</button>
      </div>
    `;
  }

  function renderChaseBoxHtml(kind, id) {
    const m = window.LIGHTING_MOUNTING;
    if (!m) return "";
    const info = kind === "switch" ? (m.switches && m.switches[id]) : (m.fixtures && m.fixtures[String(id)]);
    if (!info || (!info.chaseSpec && !info.heightLabel && !info.cable)) return "";
    const hPill = info.heightLabel
      ? `<span class="chase-h-pill">${escapeHtml(info.heightLabel)}</span>`
      : "";
    const specHtml = info.chaseSpec ? `<div class="chase-spec">${escapeHtml(info.chaseSpec)}</div>` : "";
    const cableHtml = info.cable ? `<div class="chase-cable">Кабель: ${escapeHtml(info.cable)}</div>` : "";
    return `
      <div class="chase-box">
        <div class="chase-box-head">
          <span>🔨 Где штробить / монтаж</span>
          ${hPill}
        </div>
        ${specHtml}
        ${cableHtml}
      </div>
    `;
  }

  function renderFixtureCardBodyHtml(f, inPopover) {
    const groups = getFixtureGroups(f.id);
    const boundSwitches = getSwitchesForFixture(f.id);
    const commentId = `${inPopover ? "pop" : "insp"}-fx-comment-${f.id}`;
    const cmt = state.fixtureComments[f.id] || "";

    const groupRows = groups
      .map((g) => {
        const on = isGroupOn(g.id);
        return `
          <button type="button" class="key-row ${on ? "is-on" : ""}" data-toggle-group="${g.id}">
            <span class="key-row-main">
              <span class="key-state-pill">${on ? "✓" : "×"}</span>
              <span class="key-info">
                <span class="key-label">${g.id}: ${escapeHtml(g.purpose)}</span>
                <span class="key-meta">Светильники в группе: ${g.fixtures.map((n) => `№${n}`).join(", ")}</span>
              </span>
            </span>
          </button>
        `;
      })
      .join("");

    const swChips = boundSwitches.length
      ? boundSwitches
          .map((s) => {
            const dt = getEffectiveDeviceType(s);
            return `<span class="fx-sw-chip"><span class="fx-sw-chip-focus" data-focus-switch="${s.id}">${s.id} (${dt.shortLabel})</span><button type="button" class="fx-sw-chip-unbind" data-open-bind-pair="${s.id}:${f.id}" title="Отвязать №${f.id} от ${s.id} или сменить клавишу">✕</button></span>`;
          })
          .join(" ")
      : `<span class="key-meta" style="color:#dc2626;">Пока не привязан ни к одному выключателю</span>`;

    const swOptions = state.switches
      .filter((s) => !isMasterSwitch(s))
      .map((s) => `<option value="${s.id}">${s.id} — ${s.room} (${getEffectiveDeviceType(s).shortLabel})</option>`)
      .join("");

    return `
      <div class="pop-header">
        <div class="pop-title-wrap">
          <div class="pop-id-line">
            <span class="pop-id-badge">Светильник №${f.id}</span>
            <span class="pop-room-badge">${f.room}</span>
          </div>
          <div class="pop-title">${escapeHtml(f.type)}</div>
        </div>
        ${inPopover ? `<button type="button" class="pop-close" data-close-popover="1" title="Закрыть">✕</button>` : ""}
      </div>
      ${renderChaseBoxHtml("fixture", f.id)}

      <div style="margin-bottom:8px;">
        <div class="field-label" style="margin-bottom:4px;">Управляется с выключателей:</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;">${swChips}</div>
      </div>

      <div class="pop-keys" style="margin-bottom:8px;">${groupRows}</div>

      <div class="field-row" style="margin-bottom:8px;">
        <label class="field-label" for="${inPopover ? "pop" : "insp"}-bind-target-${f.id}">Быстрая привязка к выключателю:</label>
        <div class="field-row-inline" style="margin-bottom:0;">
          <select class="field-select" id="${inPopover ? "pop" : "insp"}-bind-target-${f.id}">${swOptions}</select>
          <button type="button" class="btn-secondary" data-quick-bind-fx="${f.id}" data-select-id="${inPopover ? "pop" : "insp"}-bind-target-${f.id}">Привязать</button>
        </div>
      </div>

      <div class="field-row">
        <label class="field-label" for="${commentId}">💬 Комментарий к светильнику №${f.id}:</label>
        <textarea id="${commentId}" class="comment-textarea" data-fx-comment="${f.id}" placeholder="Например: отделить в свою клавишу, сделать RGB, поменять место...">${escapeHtml(cmt)}</textarea>
      </div>
    `;
  }

  function renderDemoSwitchHudHtml(sw) {
    const dt = getEffectiveDeviceType(sw);
    if (isMasterSwitch(sw)) {
      const powerOn = isMasterPowerActive();
      const miniFaceplate = renderSwitchFaceplateHtml(dt.id, {
        sizeClass: "is-mini",
        keyStates: [powerOn],
        keyCount: 1,
        keyLabels: ["М"]
      });
      return `
        <div class="demo-hud-head">
          <div class="demo-hud-badges">
            ${miniFaceplate}
            <span class="hw-pill hw-${dt.id}">${dt.shortLabel}</span>
            <span class="pop-room-badge">${escapeHtml(sw.room)}</span>
          </div>
          <button type="button" class="pop-close" data-close-popover="1" title="Закрыть">✕</button>
        </div>
        <div class="demo-hud-keys">
          <button type="button" class="demo-key-btn is-master ${powerOn ? "" : "is-cut"}" data-toggle-master-light="1">
            ${powerOn ? "⚡ Выключить весь свет 1–20, 22–27 (кроме 21 и розеток)" : "⚡ Включить весь свет 1–20, 22–27"}
          </button>
        </div>
      `;
    }

    const keys = getEffectiveKeys(sw);
    const keyStates = keys.map((k) => isKeyOn(k));
    const miniFaceplate = renderSwitchFaceplateHtml(dt.id, {
      sizeClass: "is-mini",
      keyStates,
      keyCount: Math.max(keys.length, dt.maxRecommendedKeys || 1),
      keyLabels: getSwitchKeyLabels(sw)
    });

    const keysButtonsHtml = keys.length
      ? keys
          .map((k, idx) => {
            const on = isKeyOn(k);
            const kNum = getKeyPlanNum(sw.id, idx, k.key);
            return `
              <button type="button" class="demo-key-btn ${on ? "is-on" : ""}" data-toggle-sw-key="${sw.id}" data-toggle-key-idx="${idx}">
                <span class="demo-key-dot">${on ? "✓" : "×"}</span>
                <span>Клавиша ${escapeHtml(kNum)} → свет ${escapeHtml(kNum)}</span>
              </button>
            `;
          })
          .join("")
      : `<span class="key-meta">К этому посту пока не привязаны светильники</span>`;

    let rgbRowHtml = "";
    if ((dt.hasDimmer || dt.hasRgb) && keys.length) {
      const firstGroups = getKeyTargetGroups(keys[0]);
      if (firstGroups.length) {
        const ps = ensureGroupSetting(firstGroups[0]);
        const activeColor = ps.color || "#ff3b5c";
        const dotsHtml = dt.hasRgb
          ? `<div class="demo-rgb-dots">${(DATA.rgbPresets || [])
              .slice(0, 6)
              .map(
                (p) =>
                  `<button type="button" class="demo-rgb-dot ${activeColor.toLowerCase() === p.color.toLowerCase() ? "is-selected" : ""}" style="background:${p.color}" data-rgb-sw="${sw.id}" data-rgb-color="${p.color}" title="${escapeHtml(p.name)}"></button>`
              )
              .join("")}</div>`
          : "";
        rgbRowHtml = `
          <div class="demo-hud-rgb">
            <span style="font-size:11.5px;font-weight:700;white-space:nowrap;">☀ <strong data-dimmer-label="${sw.id}">${ps.brightness}%</strong></span>
            <input type="range" min="15" max="100" step="5" value="${ps.brightness}" data-dimmer-slider="${sw.id}" aria-label="Яркость">
            ${dotsHtml}
          </div>
        `;
      }
    }

    return `
      <div class="demo-hud-head">
        <div class="demo-hud-badges">
          ${miniFaceplate}
          <span class="hw-pill hw-${dt.id}">${dt.shortLabel}</span>
          <span class="pop-room-badge">${escapeHtml(sw.room)}</span>
        </div>
        <button type="button" class="pop-close" data-close-popover="1" title="Закрыть">✕</button>
      </div>
      <div class="demo-hud-keys">${keysButtonsHtml}</div>
      ${rgbRowHtml}
    `;
  }

  function renderDemoFixtureHudHtml(f) {
    const planNum = getFixturePlanNum(f.id);
    const keyBtns = [];
    state.switches.forEach((sw) => {
      if (isMasterSwitch(sw)) return;
      getEffectiveKeys(sw).forEach((k, idx) => {
        if (getKeyFixtures(k).includes(f.id)) {
          const on = isKeyOn(k);
          const kNum = getKeyPlanNum(sw.id, idx, k.key);
          keyBtns.push(`
            <button type="button" class="demo-key-btn ${on ? "is-on" : ""}" data-toggle-sw-key="${sw.id}" data-toggle-key-idx="${idx}">
              <span class="demo-key-dot">${on ? "✓" : "×"}</span>
              <span>Клавиша ${escapeHtml(kNum)} (${escapeHtml(sw.room)})</span>
            </button>
          `);
        }
      });
    });

    const bodyHtml = keyBtns.length
      ? keyBtns.join("")
      : `<span class="key-meta">Прямая точка (без привязки к выключателю)</span>`;

    return `
      <div class="demo-hud-head">
        <div class="demo-hud-badges">
          <span class="pop-id-badge">Свет ${escapeHtml(planNum)}</span>
          <span class="pop-room-badge">${escapeHtml(f.room)}</span>
        </div>
        <button type="button" class="pop-close" data-close-popover="1" title="Закрыть">✕</button>
      </div>
      <div class="demo-hud-keys">${bodyHtml}</div>
    `;
  }

  function renderPopover() {
    if (!state.popoverKind || !state.popoverId) {
      popoverEl.classList.add("is-hidden");
      popoverEl.innerHTML = "";
      return;
    }

    if (state.popoverKind === "switch") {
      const sw = getSwitchById(state.popoverId);
      if (!sw) {
        popoverEl.classList.add("is-hidden");
        return;
      }
      popoverEl.innerHTML = state.demoMode ? renderDemoSwitchHudHtml(sw) : renderSwitchCardBodyHtml(sw, true);
      popoverEl.classList.remove("is-hidden");
      positionPopoverNearPlanPoint(sw.x, sw.y);
      bindInteractiveActionHandlers(popoverEl);
    } else if (state.popoverKind === "fixture") {
      const f = fixturesById.get(state.popoverId);
      if (!f) {
        popoverEl.classList.add("is-hidden");
        return;
      }
      popoverEl.innerHTML = state.demoMode ? renderDemoFixtureHudHtml(f) : renderFixtureCardBodyHtml(f, true);
      popoverEl.classList.remove("is-hidden");
      positionPopoverNearPlanPoint(f.cx, f.cy);
      bindInteractiveActionHandlers(popoverEl);
    }
  }

  function positionPopoverNearPlanPoint(px, py) {
    if (state.demoMode || !isDesktopLayout()) {
      popoverEl.style.left = "";
      popoverEl.style.top = "";
      return;
    }
    const vpRect = viewportEl.getBoundingClientRect();
    const popW = Math.min(360, vpRect.width - 24);
    const popH = Math.min(popoverEl.offsetHeight || 340, vpRect.height - 80);

    const sx = px * state.zoom + state.panX;
    const sy = py * state.zoom + state.panY;

    let left = sx + 44;
    if (left + popW > vpRect.width - 12) {
      left = sx - popW - 44;
    }
    left = Math.max(12, Math.min(left, vpRect.width - popW - 12));

    let top = sy - 50;
    top = Math.max(12, Math.min(top, vpRect.height - popH - 68));

    popoverEl.style.left = `${Math.round(left)}px`;
    popoverEl.style.top = `${Math.round(top)}px`;
  }

  function renderInspector() {
    if (state.selectedSwitchId) {
      const sw = getSwitchById(state.selectedSwitchId);
      if (sw) {
        inspectorEl.innerHTML = renderSwitchCardBodyHtml(sw, false);
        bindInteractiveActionHandlers(inspectorEl);
        return;
      }
    }
    if (state.selectedFixtureId) {
      const f = fixturesById.get(state.selectedFixtureId);
      if (f) {
        inspectorEl.innerHTML = renderFixtureCardBodyHtml(f, false);
        bindInteractiveActionHandlers(inspectorEl);
        return;
      }
    }
    inspectorEl.innerHTML = `
      <div class="inspector-empty">
        <strong>Выберите выключатель B# или номер точки 1–40 на плане</strong><br>
        • Клик по <strong>B#</strong>: тест света/вытяжки, смена типа (<em>1 кл. / 2 кл. / 3 кл. / Кнопка / Диммер / Регулятор RGB</em>) и комментарий.<br>
        • Клик по <strong>№1–40</strong>: привязки точки и комментарий к ней.<br>
        • В режиме <strong>🔗 Привязка перетягиванием</strong> (или за значок 🔗) тяните линию между <strong>B#</strong> и <strong>№1–40</strong>.
      </div>
    `;
  }

  function renderSidebarTab() {
    if (state.activeTab === "switches") {
      let html = "";
      ROOM_ORDER.forEach((room) => {
        const list = state.switches.filter((s) => s.room === room);
        if (!list.length) return;
        html += `<div class="room-section"><h3 class="room-heading"><span>${room}</span><span>${list.length} пост.</span></h3>`;
        list.forEach((sw) => {
          const st = getSwitchStatus(sw);
          const dt = getEffectiveDeviceType(sw);
          const keys = getEffectiveKeys(sw);
          const fixStr = isMasterSwitch(sw)
            ? `Весь свет (№1–${DATA.meta.totalFixtures})`
            : getSwitchFixtures(sw)
                .map((n) => `№${n}`)
                .join(", ");
          const selectedCls = state.selectedSwitchId === sw.id ? "is-selected" : "";
          const totalSlots = Math.max(keys.length, dt.maxRecommendedKeys);
          const showSlotTag = dt.maxRecommendedKeys >= 2 || keys.length > 1;

          let keysHtml = "";
          if (isMasterSwitch(sw)) {
            const powerOn = isMasterPowerActive();
            keysHtml = `
              <button type="button" class="chip-row ${powerOn ? "is-on" : ""}" data-toggle-master-light="1">
                <span class="chip-left">
                  <span class="chip-badge ${powerOn ? "is-on" : "is-off"}">${powerOn ? "✓" : "×"}</span>
                  <span>${powerOn ? "Питание света ВКЛ — нажать перед уходом" : "Весь свет ОТКЛЮЧЕН — нажать чтобы вернуть"}</span>
                </span>
                <span class="chip-fixtures">${powerOn ? "Вкл" : "Откл"}</span>
              </button>
            `;
          } else if (!keys.length && dt.maxRecommendedKeys < 2) {
            keysHtml = '<span class="key-meta">Нет клавиш — перетяните сюда клавишу или привяжите светильник</span>';
          } else {
            const slotRows = [];
            for (let idx = 0; idx < totalSlots; idx++) {
              const k = keys[idx];
              if (!k || isEmptyKey(k)) {
                slotRows.push(
                  `<div class="key-meta chip-empty-slot" data-drop-empty-sw="${sw.id}" data-drop-empty-slot="${idx}">Клавиша ${idx + 1} свободна — перетащите сюда клавишу</div>`
                );
                continue;
              }
              const on = isKeyOn(k);
              const targets = getKeyTargetGroups(k);
              const kf = getKeyFixtures(k)
                .map((n) => `№${n}`)
                .join(", ");
              slotRows.push(`
                <button type="button" class="chip-row ${on ? "is-on" : ""}" draggable="true" data-drag-from-switch="${sw.id}" data-drag-key-index="${idx}" data-drop-key-sw="${sw.id}" data-drop-key-idx="${idx}" data-toggle-sw-key="${sw.id}" data-toggle-key-idx="${idx}">
                  <span class="chip-left">
                    <span class="drag-grip" title="Перетащите на другую клавишу (поменять местами) или на другой выключатель">⠿</span>
                    ${showSlotTag ? `<span class="chip-slot-tag">Клавиша ${escapeHtml(getKeyPlanNum(sw.id, idx, k.key))}</span>` : ""}
                    <span class="chip-badge ${on ? "is-on" : "is-off"}">${on ? "✓" : "×"}</span>
                    <span>${targets.join("+")}: ${escapeHtml(k.label)}</span>
                  </span>
                  <span class="chip-fixtures">${kf}</span>
                </button>
              `);
            }
            keysHtml = slotRows.join("");
          }

          const firstActiveKey = keys.find((k) => !isEmptyKey(k));
          const firstTargets = firstActiveKey ? getKeyTargetGroups(firstActiveKey) : [];
          const firstSetting = firstTargets.length ? ensureGroupSetting(firstTargets[0]) : { brightness: 80, color: "#ff3b5c" };
          const miniFace = renderSwitchFaceplateHtml(dt.id, {
            sizeClass: "is-mini",
            keyStates: st.keyStates,
            keyCount: keys.length,
            keyLabels: getSwitchKeyLabels(sw),
            slotEmpty: [isEmptyKey(keys[0]), isEmptyKey(keys[1]), isEmptyKey(keys[2])],
            brightness: firstSetting.brightness,
            rgbColor: firstSetting.color || "#ff3b5c"
          });

          const commentPreview =
            sw.comment && sw.comment.trim()
              ? `<div class="switch-comment-preview" data-comment-preview-sw="${sw.id}">💬 ${escapeHtml(sw.comment.trim())}</div>`
              : `<div class="switch-comment-preview" data-comment-preview-sw="${sw.id}" style="display:none;"></div>`;

          html += `
            <div class="switch-card ${selectedCls}" data-card-switch="${sw.id}">
              <div class="switch-card-head" data-focus-switch="${sw.id}">
                <div class="switch-card-left">
                  <span class="mini-status ${st.isOn ? "is-on" : "is-off"}">${st.isOn ? "✓" : "×"}</span>
                  ${miniFace}
                  <span class="hw-pill hw-${dt.id}">${dt.shortLabel}</span>
                  <span class="pop-room-badge">${escapeHtml(sw.room)}</span>
                </div>
                <span class="chip-fixtures">${fixStr || "пусто"}</span>
              </div>
              <div class="switch-card-sub">${escapeHtml(sw.title)}</div>
              ${commentPreview}
              <div class="switch-card-keys">${keysHtml}</div>
            </div>
          `;
        });
        html += `</div>`;
      });
      tabContentEl.innerHTML = html;
      bindInteractiveActionHandlers(tabContentEl);
    } else if (state.activeTab === "fixtures") {
      const rows = DATA.fixtures
        .map((f) => {
          const on = getFixtureActiveGroups(f.id).length > 0;
          const sws = getSwitchesForFixture(f.id)
            .map((s) => s.id)
            .join(", ");
          const cmt = (state.fixtureComments[f.id] || "").trim();
          return `
            <tr class="is-clickable ${state.selectedFixtureId === f.id ? "is-selected-row" : ""}" data-focus-fixture="${f.id}">
              <td><span class="fixture-num-pill ${on ? "is-on" : ""}">${f.id}</span></td>
              <td>${f.room}</td>
              <td>
                <div>${escapeHtml(f.type)}</div>
                ${cmt ? `<div style="color:#15803d;font-size:10.5px;margin-top:2px;">💬 ${escapeHtml(cmt)}</div>` : ""}
              </td>
              <td><strong>${sws || "—"}</strong></td>
            </tr>
          `;
        })
        .join("");

      tabContentEl.innerHTML = `
        <div class="room-section">
          <h3 class="room-heading"><span>38 точек света + 1 вентиляция</span><span>клик = комментарий и привязка</span></h3>
          <table class="fixture-table">
            <thead>
              <tr><th>№</th><th>Пом.</th><th>Светильник / устройство</th><th>Посты</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
      bindInteractiveActionHandlers(tabContentEl);
    } else if (state.activeTab === "edits") {
      const diffs = computeEditsSummary();
      const itemsHtml = diffs.length
        ? diffs
            .map(
              (d) => `<div class="edit-log-item ${d.kind === "comment" ? "is-comment" : ""}">${escapeHtml(d.label)}</div>`
            )
            .join("")
        : `<div class="pop-note">Пока изменений и комментариев нет. Передвигайте выключатели, меняйте типы, перетягивайте привязки или добавляйте комментарии к любому B# и №1–40.</div>`;

      tabContentEl.innerHTML = `
        <div class="room-section">
          <h3 class="room-heading"><span>Ваши правки и комментарии</span><span>${diffs.length} шт.</span></h3>
          ${itemsHtml}
          <div style="margin-top:10px;">
            <button type="button" class="btn-primary" style="width:100%;" data-open-export="1">📋 Скопировать все правки для чата</button>
          </div>
        </div>
      `;
      bindInteractiveActionHandlers(tabContentEl);
    } else if (state.activeTab === "questions") {
      const cardsHtml = DATA.openQuestions
        .map(
          (q) => `
          <div class="question-card">
            <div class="question-title">${q.id}. ${q.title}</div>
            <div class="question-detail">${q.detail}</div>
            <span class="question-status">${q.status}</span>
          </div>
        `
        )
        .join("");

      const doorSwitches = state.switches.filter((s) => s.doorCheck);
      const doorHtml = `
        <div class="door-summary-box">
          <h4>Посты, требующие проверки после подтверждения открывания дверей:</h4>
          <ul>
            ${doorSwitches.map((s) => `<li><strong>${s.id}</strong> (${s.room}): ${s.doorNote}</li>`).join("")}
          </ul>
        </div>
      `;
      tabContentEl.innerHTML = cardsHtml + doorHtml;
    }
  }

  function renderStats() {
    const lightFixtures = DATA.fixtures.filter((f) => !f.isNonLight);
    const activeGroups = state.groups.filter((g) => isGroupOn(g.id)).length;
    const activeFixtures = lightFixtures.filter((f) => getFixtureActiveGroups(f.id).length > 0).length;
    statGroupsEl.textContent = `${activeGroups} / ${state.groups.length}`;
    statFixturesEl.textContent = `${activeFixtures} / ${lightFixtures.length}`;
    updateEditBadges();
  }

  function renderMasterBanner() {
    if (!masterOffBannerEl) return;
    const cut = hasActiveMasterSwitch() && state.masterLightOn === false;
    masterOffBannerEl.classList.toggle("is-hidden", !cut);
  }

  function renderAll() {
    renderPlanAdditions();
    renderFixturesGlow();
    renderTempLinks();
    renderFixtureHits();
    renderSwitchMarkers();
    renderMasterBanner();
    renderPopover();
    renderInspector();
    renderSidebarTab();
    renderStats();
  }

  /* ==================== MODALS (BIND & EXPORT) ==================== */

  function openBindModal(swId, fixtureId, preferredSlotIdx) {
    const sw = getSwitchById(swId);
    const f = fixturesById.get(fixtureId);
    if (!sw || !f) return;

    const effKeys = getEffectiveKeys(sw);
    const dt = getEffectiveDeviceType(sw);
    const candidateGroups = getFixtureGroups(fixtureId);

    const linkedKeyIndices = [];
    const linkedGroupIds = new Set();
    effKeys.forEach((k, idx) => {
      if (isEmptyKey(k)) return;
      if (getKeyFixtures(k).includes(fixtureId)) {
        linkedKeyIndices.push({ idx, k });
        getKeyTargetGroups(k).forEach((gid) => linkedGroupIds.add(gid));
      }
    });

    const maxSlots = Math.max(dt.maxRecommendedKeys, effKeys.length);
    const slotSubText = (k) =>
      !isEmptyKey(k)
        ? `${getKeyTargetGroups(k).join("+")} (${getKeyFixtures(k)
            .map((n) => `№${n}`)
            .join(", ")})`
        : "Свободна";

    let slots = [];
    if (maxSlots >= 2) {
      for (let i = 0; i < maxSlots; i++) {
        slots.push({
          idx: i,
          strategy: "append",
          title: `Клавиша ${i + 1}`,
          sub: slotSubText(effKeys[i])
        });
      }
      if (
        dt.id === "rocker_2" &&
        maxSlots === 2 &&
        !isEmptyKey(effKeys[0]) &&
        !isEmptyKey(effKeys[1])
      ) {
        slots.push({
          idx: 2,
          strategy: "expand_3",
          title: "+ Клавиша 3 (сделать 3 кл.)",
          sub: `Расширит ${sw.id} до 3-клавишного`
        });
      }
    } else if (effKeys.length >= 1 && !isEmptyKey(effKeys[0]) && (dt.id === "rocker_1" || dt.id === "button_1")) {
      slots = [
        {
          idx: 0,
          strategy: "append",
          title: "Клавиша 1 (оставить 1 кл.)",
          sub: slotSubText(effKeys[0])
        },
        {
          idx: 1,
          strategy: "expand_2",
          title: "+ Клавиша 2 (сделать 2 кл.)",
          sub: `Расширит ${sw.id} до 2-клавишного`
        }
      ];
    }

    let activeSlot = 0;
    if (slots.length >= 2) {
      if (typeof preferredSlotIdx === "number" && slots.some((s) => s.idx === preferredSlotIdx)) {
        activeSlot = preferredSlotIdx;
      } else {
        let firstEmpty = -1;
        for (let i = 0; i < dt.maxRecommendedKeys; i++) {
          if (isEmptyKey(effKeys[i])) {
            firstEmpty = i;
            break;
          }
        }
        activeSlot = firstEmpty !== -1 ? firstEmpty : 0;
      }
    }

    function renderModalBody() {
      let unbindHtml = "";
      linkedKeyIndices.forEach(({ idx, k }) => {
        const hasSlots = effKeys.length > 1 || dt.maxRecommendedKeys >= 2;
        const keyLabelGen = hasSlots ? `Клавиши ${idx + 1}` : sw.id;
        const keyLabelPrep = hasSlots ? `Клавише ${idx + 1}` : sw.id;
        const keyLabelAcc = hasSlots ? `всю Клавишу ${idx + 1}` : "клавишу";
        const kTargets = getKeyTargetGroups(k);

        if (kTargets.length > 1) {
          kTargets.forEach((gid) => {
            const grp = getGroupById(gid);
            if (!grp || !grp.fixtures.includes(fixtureId)) return;
            unbindHtml += `
              <button type="button" class="modal-choice-btn is-danger" data-modal-unbind-group="${gid}" data-modal-unbind-key-idx="${idx}">
                <span class="modal-choice-title">Убрать только ${gid} (№${fixtureId}) с ${keyLabelGen} на ${sw.id}</span>
                <span class="modal-choice-sub">Остальные группы на этой клавише сохранятся</span>
              </button>
            `;
          });
        } else if (kTargets.length === 1) {
          const g0 = getGroupById(kTargets[0]);
          if (g0 && g0.fixtures.length > 1 && !g0.inseparable) {
            unbindHtml += `
              <button type="button" class="modal-choice-btn is-danger" data-modal-unbind-single-fx="${g0.id}">
                <span class="modal-choice-title">Отвязать только светильник №${fixtureId} от ${sw.id}</span>
                <span class="modal-choice-sub">Остальные светильники группы ${g0.id} останутся на ${keyLabelPrep}</span>
              </button>
            `;
          }
        }

        unbindHtml += `
          <button type="button" class="modal-choice-btn is-danger" data-modal-unbind-idx="${idx}">
            <span class="modal-choice-title">Отвязать ${keyLabelAcc} (${kTargets.join("+")}) от ${sw.id}</span>
            <span class="modal-choice-sub">Полностью освободить эту клавишу на ${sw.id}</span>
          </button>
        `;
      });

      const slotPickerHtml =
        slots.length >= 2
          ? `
            <div class="slot-picker-wrap">
              <div class="slot-picker-label">На какую клавишу ${sw.id} назначить №${fixtureId}:</div>
              <div class="slot-picker-tabs">
                ${slots
                  .map(
                    (s) => `
                  <button type="button" class="slot-picker-btn ${activeSlot === s.idx ? "is-active" : ""}" data-pick-slot="${s.idx}">
                    <span class="slot-picker-title">${escapeHtml(s.title)}</span>
                    <span class="slot-picker-sub">${escapeHtml(s.sub)}</span>
                  </button>
                `
                  )
                  .join("")}
              </div>
            </div>
          `
          : "";

      const slotKey = !isEmptyKey(effKeys[activeSlot]) ? effKeys[activeSlot] : null;
      const slotGroupIds = new Set(slotKey ? getKeyTargetGroups(slotKey) : []);
      const hasMultiSlots = slots.length >= 2;
      const slotAcc = hasMultiSlots ? `Клавишу ${activeSlot + 1}` : sw.id;
      const slotInstr = hasMultiSlots ? `Клавишей ${activeSlot + 1}` : `клавишей ${sw.id}`;
      const slotPrep = hasMultiSlots ? `Клавише ${activeSlot + 1}` : sw.id;

      let bindHtml = "";
      candidateGroups.forEach((g) => {
        const fxList = g.fixtures.map((n) => `№${n}`).join(", ");
        if (!slotKey) {
          const pickedSlot = slots.find((s) => s.idx === activeSlot);
          const freeStrat = (pickedSlot && pickedSlot.strategy) || "append";
          const expandNote =
            freeStrat === "expand_2"
              ? ` (расширит ${sw.id} до 2 кл.)`
              : freeStrat === "expand_3"
              ? ` (расширит ${sw.id} до 3 кл.)`
              : "";

          bindHtml += `
            <button type="button" class="modal-choice-btn" data-modal-bind="${g.id}" data-bind-mode="move" data-slot-strategy="${freeStrat}" data-slot-idx="${activeSlot}">
              <span class="modal-choice-title">Перенести группу ${g.id} (${fxList}) на ${slotAcc}${expandNote}</span>
              <span class="modal-choice-sub">Уберёт эту группу со старого места и назначит на ${slotAcc}</span>
            </button>
          `;
          if (!linkedGroupIds.has(g.id)) {
            bindHtml += `
              <button type="button" class="modal-choice-btn" data-modal-bind="${g.id}" data-bind-mode="duplicate" data-slot-strategy="${freeStrat}" data-slot-idx="${activeSlot}">
                <span class="modal-choice-title">Дублировать ${g.id} (${fxList}) на ${slotAcc} (проходное управление)${expandNote}</span>
                <span class="modal-choice-sub">Оставит на старом выключателе и добавит управление с ${slotAcc}</span>
              </button>
            `;
          }
          if (g.fixtures.length > 1 && !g.inseparable) {
            bindHtml += `
              <button type="button" class="modal-choice-btn" data-modal-split="${g.id}" data-slot-strategy="${freeStrat}" data-slot-idx="${activeSlot}">
                <span class="modal-choice-title">Выделить только №${fixtureId} в отдельную группу на ${slotAcc}${expandNote}</span>
                <span class="modal-choice-sub">Отделит №${fixtureId} от группы ${g.id} (${fxList}) и привяжет к ${slotAcc}</span>
              </button>
            `;
          }
        } else {
          const existingShort = getKeyTargetGroups(slotKey).join("+");
          if (slotGroupIds.has(g.id)) {
            bindHtml += `<div class="pop-note">Группа <strong>${g.id}</strong> уже находится на ${slotPrep} (${sw.id}). Выберите другую клавишу выше или используйте кнопки отвязки.</div>`;
          } else {
            bindHtml += `
              <button type="button" class="modal-choice-btn" data-modal-bind="${g.id}" data-bind-mode="move" data-slot-strategy="merge" data-slot-idx="${activeSlot}">
                <span class="modal-choice-title">Объединить с ${slotInstr} (${existingShort} + ${g.id}) — перенести</span>
                <span class="modal-choice-sub">Обе группы будут включаться вместе одной клавишей; ${g.id} уберётся со старого поста</span>
              </button>
            `;
            if (!linkedGroupIds.has(g.id)) {
              bindHtml += `
                <button type="button" class="modal-choice-btn" data-modal-bind="${g.id}" data-bind-mode="duplicate" data-slot-strategy="merge" data-slot-idx="${activeSlot}">
                  <span class="modal-choice-title">Объединить с ${slotInstr} (${existingShort} + ${g.id}) — дублировать</span>
                  <span class="modal-choice-sub">Добавит ${g.id} на ${slotAcc}, сохранив прежнее управление на другом выключателе</span>
                </button>
              `;
            }
            bindHtml += `
              <button type="button" class="modal-choice-btn" data-modal-bind="${g.id}" data-bind-mode="move" data-slot-strategy="replace" data-slot-idx="${activeSlot}">
                <span class="modal-choice-title">Заменить ${slotAcc} (${existingShort} → ${g.id})</span>
                <span class="modal-choice-sub">Прежняя привязка на ${slotPrep} будет заменена на ${g.id} (${fxList})</span>
              </button>
            `;
            if (g.fixtures.length > 1 && !g.inseparable) {
              bindHtml += `
                <button type="button" class="modal-choice-btn" data-modal-split="${g.id}" data-slot-strategy="merge" data-slot-idx="${activeSlot}">
                  <span class="modal-choice-title">Выделить только №${fixtureId} и объединить с ${slotInstr} (${existingShort})</span>
                  <span class="modal-choice-sub">Отделит №${fixtureId} от группы ${g.id} и добавит к ${slotPrep}</span>
                </button>
                <button type="button" class="modal-choice-btn" data-modal-split="${g.id}" data-slot-strategy="replace" data-slot-idx="${activeSlot}">
                  <span class="modal-choice-title">Выделить только №${fixtureId} и заменить ${slotAcc} (${existingShort} → №${fixtureId})</span>
                  <span class="modal-choice-sub">Отделит №${fixtureId} от группы ${g.id} и поставит вместо ${existingShort}</span>
                </button>
              `;
            }
          }
        }
      });

      modalBoxEl.innerHTML = `
        <div class="modal-header">
          <h3>Привязка: светильник №${fixtureId} ↔ выключатель ${sw.id} (${dt.shortLabel})</h3>
          <button type="button" class="pop-close" data-modal-close="1">✕</button>
        </div>
        <div class="pop-note"><strong>№${fixtureId} (${f.room}):</strong> ${escapeHtml(f.type)}</div>
        ${unbindHtml ? `<div class="modal-choice-list">${unbindHtml}</div>` : ""}
        ${slotPickerHtml}
        <div class="modal-choice-list">${bindHtml}</div>
        <div class="modal-footer">
          <button type="button" class="btn-secondary" data-modal-close="1">Отмена</button>
        </div>
      `;

      modalBoxEl.querySelectorAll("[data-pick-slot]").forEach((b) =>
        b.addEventListener("click", () => {
          activeSlot = Number(b.getAttribute("data-pick-slot"));
          renderModalBody();
        })
      );
      modalBoxEl.querySelectorAll("[data-modal-close]").forEach((b) =>
        b.addEventListener("click", closeModal)
      );
      modalBoxEl.querySelectorAll("[data-modal-unbind-idx]").forEach((b) =>
        b.addEventListener("click", () => {
          unbindKeyAtIndex(sw.id, Number(b.getAttribute("data-modal-unbind-idx")));
          closeModal();
        })
      );
      modalBoxEl.querySelectorAll("[data-modal-unbind-group]").forEach((b) =>
        b.addEventListener("click", () => {
          removeSingleGroupFromKey(
            sw.id,
            Number(b.getAttribute("data-modal-unbind-key-idx")),
            b.getAttribute("data-modal-unbind-group")
          );
          closeModal();
        })
      );
      modalBoxEl.querySelectorAll("[data-modal-unbind-single-fx]").forEach((b) =>
        b.addEventListener("click", () => {
          unbindSingleFixtureFromGroup(b.getAttribute("data-modal-unbind-single-fx"), fixtureId);
          closeModal();
        })
      );
      modalBoxEl.querySelectorAll("[data-modal-bind]").forEach((b) =>
        b.addEventListener("click", () => {
          bindGroupToSwitch(
            b.getAttribute("data-modal-bind"),
            sw.id,
            b.getAttribute("data-bind-mode"),
            b.getAttribute("data-slot-strategy"),
            Number(b.getAttribute("data-slot-idx") || 0)
          );
          closeModal();
        })
      );
      modalBoxEl.querySelectorAll("[data-modal-split]").forEach((b) =>
        b.addEventListener("click", () => {
          splitFixtureToNewGroup(
            b.getAttribute("data-modal-split"),
            fixtureId,
            sw.id,
            b.getAttribute("data-slot-strategy"),
            Number(b.getAttribute("data-slot-idx") || 0)
          );
          closeModal();
        })
      );
    }

    renderModalBody();
    modalBackdropEl.classList.remove("is-hidden");
  }

  function openSingleKeyConversionModal(sw, newTypeId) {
    const newDt = DATA.deviceTypes[newTypeId];
    const effKeys = getEffectiveKeys(sw).filter((k) => !isEmptyKey(k));
    if (!sw || !newDt || effKeys.length <= 1) return;

    const allTargets = Array.from(new Set(effKeys.flatMap((k) => getKeyTargetGroups(k))));
    const allFxStr = getSwitchFixtures(sw)
      .map((n) => `№${n}`)
      .join(", ");

    const keepOneButtons = effKeys
      .map((k, idx) => {
        const fx = getKeyFixtures(k)
          .map((n) => `№${n}`)
          .join(", ");
        return `
          <button type="button" class="modal-choice-btn" data-conv-mode="keep" data-keep-idx="${idx}">
            <span class="modal-choice-title">Оставить только: ${getKeyTargetGroups(k).join("+")} (${fx || "пусто"})</span>
            <span class="modal-choice-sub">Остальные клавиши будут отвязаны от ${sw.id}</span>
          </button>
        `;
      })
      .join("");

    modalBoxEl.innerHTML = `
      <div class="modal-header">
        <h3>Перевод ${sw.id} в «${newDt.shortLabel}»</h3>
        <button type="button" class="pop-close" data-modal-close="1">✕</button>
      </div>
      <div class="pop-note">Сейчас на <strong>${sw.id}</strong> назначено ${effKeys.length} клавиши, а механизм <strong>«${newDt.fullLabel}»</strong> поддерживает только 1 канал управления. Что сделать с ${effKeys.length > 2 ? "лишними клавишами" : "второй клавишей"}?</div>
      <div class="modal-choice-list">
        <button type="button" class="modal-choice-btn" data-conv-mode="split_new">
          <span class="modal-choice-title">Вынести ${effKeys.length > 2 ? "лишние клавиши" : "2-ю клавишу"} в отдельный выключатель рядом</span>
          <span class="modal-choice-sub">На ${sw.id} останется только 1-я клавиша (${getKeyTargetGroups(effKeys[0]).join("+")}), а для ${effKeys.length > 2 ? "остальных" : "2-й"} рядом на плане появится новый пост</span>
        </button>
        <button type="button" class="modal-choice-btn" data-conv-mode="merge_one">
          <span class="modal-choice-title">Объединить все светильники (${allFxStr}) на одну клавишу ${sw.id}</span>
          <span class="modal-choice-sub">1 клавиша на ${sw.id} будет включать все эти группы одновременно</span>
        </button>
        ${keepOneButtons}
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" data-modal-close="1">Отмена</button>
      </div>
    `;
    modalBackdropEl.classList.remove("is-hidden");

    modalBoxEl.querySelectorAll("[data-modal-close]").forEach((b) =>
      b.addEventListener("click", closeModal)
    );
    modalBoxEl.querySelectorAll("[data-conv-mode]").forEach((b) => {
      b.addEventListener("click", () => {
        const mode = b.getAttribute("data-conv-mode");
        if (mode === "split_new") {
          const firstCopy = deepClone(effKeys[0]);
          delete firstCopy.variantOnly;
          const extraKeys = effKeys.slice(1).map((k, idx) => {
            const c = deepClone(k);
            delete c.variantOnly;
            c.key = idx + 1;
            return c;
          });
          sw.keys = [firstCopy];
          sw.deviceType = newTypeId;
          if (sw.specialLogic === "balcony_all") delete sw.specialLogic;

          const spot = findNearbyFreeSwitchSpot(sw.x, sw.y);
          const extraType =
            extraKeys.length >= 3
              ? "rocker_3"
              : extraKeys.length === 2
              ? newDt.isImpulse
                ? "button_2"
                : "rocker_2"
              : newDt.isImpulse
              ? "button_1"
              : "rocker_1";
          addNewSwitch({
            room: sw.room,
            x: spot.x,
            y: spot.y,
            deviceType: extraType,
            title: `${sw.room} — вынесенный пост из ${sw.id}`,
            doorNote: `Вынесено пользователем из ${sw.id}`,
            keys: extraKeys,
            silent: true,
            skipSaveAndRender: true
          });
          state.selectedSwitchId = sw.id;
        } else if (mode === "merge_one") {
          sw.keys = [buildMergedKeyObject(allTargets)];
          sw.deviceType = newTypeId;
          if (sw.specialLogic === "balcony_all") delete sw.specialLogic;
        } else if (mode === "keep") {
          const idx = Number(b.getAttribute("data-keep-idx"));
          const chosen = deepClone(effKeys[idx] || effKeys[0]);
          delete chosen.variantOnly;
          chosen.key = 1;
          sw.keys = [chosen];
          sw.deviceType = newTypeId;
          if (sw.specialLogic === "balcony_all") delete sw.specialLogic;
        }
        saveToStorage();
        closeModal();
        renderAll();
      });
    });
  }

  function openTwoKeyConversionModal(sw, newTypeId) {
    const newDt = DATA.deviceTypes[newTypeId];
    const effKeys = getEffectiveKeys(sw).filter((k) => !isEmptyKey(k));
    if (!sw || !newDt || effKeys.length <= 2) return;

    const restKeys = effKeys.slice(1);
    const merged23Targets = Array.from(new Set(restKeys.flatMap((k) => getKeyTargetGroups(k))));
    const k1Groups = getKeyTargetGroups(effKeys[0]).join("+");
    const k2Groups = getKeyTargetGroups(effKeys[1]).join("+");
    const k3Groups = effKeys.slice(2).map((k) => getKeyTargetGroups(k).join("+")).join(" + ");

    modalBoxEl.innerHTML = `
      <div class="modal-header">
        <h3>Перевод ${sw.id} в «${newDt.shortLabel}»</h3>
        <button type="button" class="pop-close" data-modal-close="1">✕</button>
      </div>
      <div class="pop-note">Сейчас на <strong>${sw.id}</strong> назначено ${effKeys.length} клавиши, а механизм <strong>«${newDt.fullLabel}»</strong> поддерживает 2 клавиши. Что сделать с 3-й клавишей (${k3Groups})?</div>
      <div class="modal-choice-list">
        <button type="button" class="modal-choice-btn" data-conv2-mode="split_new">
          <span class="modal-choice-title">Вынести 3-ю клавишу (${k3Groups}) в отдельный пост рядом</span>
          <span class="modal-choice-sub">На ${sw.id} останутся Кл.1 (${k1Groups}) и Кл.2 (${k2Groups}), а для 3-й появится новый 1-кл. пост</span>
        </button>
        <button type="button" class="modal-choice-btn" data-conv2-mode="merge_23">
          <span class="modal-choice-title">Объединить 2-ю и 3-ю клавиши на Клавишу 2</span>
          <span class="modal-choice-sub">Кл.1 (${k1Groups}) сохранится отдельно, а Кл.2 будет включать ${merged23Targets.join("+")}</span>
        </button>
        <button type="button" class="modal-choice-btn is-danger" data-conv2-mode="keep_12">
          <span class="modal-choice-title">Оставить Кл.1 (${k1Groups}) и Кл.2 (${k2Groups}), отвязать 3-ю</span>
          <span class="modal-choice-sub">3-я клавиша (${k3Groups}) будет снята с ${sw.id}</span>
        </button>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" data-modal-close="1">Отмена</button>
      </div>
    `;
    modalBackdropEl.classList.remove("is-hidden");

    modalBoxEl.querySelectorAll("[data-modal-close]").forEach((b) =>
      b.addEventListener("click", closeModal)
    );
    modalBoxEl.querySelectorAll("[data-conv2-mode]").forEach((b) => {
      b.addEventListener("click", () => {
        const mode = b.getAttribute("data-conv2-mode");
        const k1Copy = deepClone(effKeys[0]);
        delete k1Copy.variantOnly;
        k1Copy.key = 1;
        const k2Copy = deepClone(effKeys[1]);
        delete k2Copy.variantOnly;
        k2Copy.key = 2;

        if (mode === "split_new") {
          const extraKeys = effKeys.slice(2).map((k, idx) => {
            const c = deepClone(k);
            delete c.variantOnly;
            c.key = idx + 1;
            return c;
          });
          sw.keys = [k1Copy, k2Copy];
          sw.deviceType = newTypeId;
          if (sw.specialLogic === "balcony_all") delete sw.specialLogic;

          const spot = findNearbyFreeSwitchSpot(sw.x, sw.y);
          const extraType =
            extraKeys.length >= 2
              ? newDt.isImpulse
                ? "button_2"
                : "rocker_2"
              : newDt.isImpulse
              ? "button_1"
              : "rocker_1";
          addNewSwitch({
            room: sw.room,
            x: spot.x,
            y: spot.y,
            deviceType: extraType,
            title: `${sw.room} — вынесенный пост из ${sw.id}`,
            doorNote: `Вынесено пользователем из ${sw.id}`,
            keys: extraKeys,
            silent: true,
            skipSaveAndRender: true
          });
          state.selectedSwitchId = sw.id;
        } else if (mode === "merge_23") {
          const merged2 = buildMergedKeyObject(merged23Targets);
          merged2.key = 2;
          sw.keys = [k1Copy, merged2];
          sw.deviceType = newTypeId;
          if (sw.specialLogic === "balcony_all") delete sw.specialLogic;
        } else if (mode === "keep_12") {
          sw.keys = [k1Copy, k2Copy];
          sw.deviceType = newTypeId;
          if (sw.specialLogic === "balcony_all") delete sw.specialLogic;
        }
        saveToStorage();
        closeModal();
        renderAll();
      });
    });
  }

  function handleDeviceTypeChange(sw, newTypeId, selectEl) {
    const newDt = DATA.deviceTypes[newTypeId];
    if (!sw || !newDt) return;
    const effKeys = getEffectiveKeys(sw);
    const activeEffKeys = effKeys.filter((k) => !isEmptyKey(k));

    if (newDt.maxRecommendedKeys === 1 && activeEffKeys.length > 1) {
      if (selectEl) selectEl.value = sw.deviceType;
      openSingleKeyConversionModal(sw, newTypeId);
      return;
    }

    if (newDt.maxRecommendedKeys === 2 && activeEffKeys.length > 2) {
      if (selectEl) selectEl.value = sw.deviceType;
      openTwoKeyConversionModal(sw, newTypeId);
      return;
    }

    if (newDt.maxRecommendedKeys === 1) {
      sw.keys = activeEffKeys.map((k) => {
        const kept = deepClone(k);
        if (sw.id === "B15" && state.variant === "B") delete kept.variantOnly;
        kept.key = 1;
        return kept;
      });
    } else if (newDt.maxRecommendedKeys === 2) {
      if (effKeys.length > 2) {
        sw.keys = activeEffKeys.map((k, idx) => {
          const kept = deepClone(k);
          kept.key = idx + 1;
          return kept;
        });
      } else {
        expandMergedKeyToKeys(sw, 2);
      }
    } else if (newDt.maxRecommendedKeys === 3) {
      expandMergedKeyToKeys(sw, 3);
    }

    sw.deviceType = newTypeId;
    saveToStorage();
    renderAll();
  }

  function openExportModal() {
    const md = buildExportMarkdown();
    modalBoxEl.innerHTML = `
      <div class="modal-header">
        <h3>Готовые правки для отправки в чат</h3>
        <button type="button" class="pop-close" data-modal-close="1">✕</button>
      </div>
      <div class="pop-note">Нажмите «Скопировать в буфер» и просто вставьте (<strong>Cmd + V</strong>) сюда в чат агента — я сразу применю всё к проекту.</div>
      <textarea id="export-md-textarea" class="export-textarea" readonly>${escapeHtml(md)}</textarea>
      <input type="file" id="input-upload-json" accept=".json,application/json" style="display:none;">
      <div class="modal-footer">
        <button type="button" class="btn-secondary" id="btn-upload-json">Загрузить .json</button>
        <button type="button" class="btn-secondary" id="btn-download-json">Скачать .json</button>
        <button type="button" class="btn-primary" id="btn-copy-md">📋 Скопировать в буфер</button>
        <button type="button" class="btn-secondary" data-modal-close="1">Закрыть</button>
      </div>
    `;
    modalBackdropEl.classList.remove("is-hidden");

    modalBoxEl.querySelectorAll("[data-modal-close]").forEach((b) =>
      b.addEventListener("click", closeModal)
    );
    const copyBtn = document.getElementById("btn-copy-md");
    const ta = document.getElementById("export-md-textarea");
    copyBtn.addEventListener("click", () => {
      ta.select();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value).catch(() => document.execCommand("copy"));
      } else {
        document.execCommand("copy");
      }
      copyBtn.textContent = "✓ Скопировано! Вставьте в чат";
    });
    const uploadInput = document.getElementById("input-upload-json");
    document.getElementById("btn-upload-json").addEventListener("click", () => {
      uploadInput.click();
    });
    uploadInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result || ""));
          if (!parsed || !Array.isArray(parsed.switches) || !Array.isArray(parsed.groups)) {
            alert("Файл JSON не содержит корректных полей switches и groups.");
            return;
          }
          state.variant = parsed.variant === "B" ? "B" : "A";
          state.switches = parsed.switches;
          state.groups = parsed.groups;
          state.fixtureComments = parsed.fixtureComments || {};
          state.groupSettings = buildInitialGroupSettings(state.groups);
          state.masterSwitchDeleted = !!parsed.masterSwitchDeleted;
          state.masterLightOn = parsed.masterLightOn === false ? false : true;
          if (!state.masterSwitchDeleted && !state.switches.some((s) => isMasterSwitch(s))) {
            const baseMaster = baselineSwitchMap.get("BM");
            if (baseMaster) {
              const b1Idx = state.switches.findIndex((s) => s.id === "B1");
              const copy = deepClone(baseMaster);
              if (b1Idx !== -1) state.switches.splice(b1Idx + 1, 0, copy);
              else state.switches.unshift(copy);
            }
          }
          state.selectedSwitchId = null;
          state.selectedFixtureId = null;
          state.popoverKind = null;
          state.popoverId = null;
          if (btnVariantA) btnVariantA.classList.toggle("is-active", state.variant === "A");
          if (btnVariantB) btnVariantB.classList.toggle("is-active", state.variant === "B");
          saveToStorage();
          closeModal();
          renderAll();
        } catch (err) {
          alert("Не удалось прочитать JSON-файл.");
        }
      };
      reader.readAsText(file);
    });
    document.getElementById("btn-download-json").addEventListener("click", () => {
      const dataStr = JSON.stringify(
        {
          variant: state.variant,
          masterLightOn: state.masterLightOn,
          masterSwitchDeleted: state.masterSwitchDeleted,
          switches: state.switches,
          groups: state.groups,
          fixtureComments: state.fixtureComments
        },
        null,
        2
      );
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "lighting_edits.json";
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  function closeModal() {
    modalBackdropEl.classList.add("is-hidden");
    modalBoxEl.innerHTML = "";
  }

  modalBackdropEl.addEventListener("click", (e) => {
    if (e.target === modalBackdropEl) closeModal();
  });

  /* ==================== ACTION HANDLERS ==================== */

  function selectSwitch(swId, openPop) {
    state.selectedSwitchId = swId;
    state.selectedFixtureId = null;
    if (state.demoMode || (openPop && !isDesktopLayout())) {
      state.popoverKind = "switch";
      state.popoverId = swId;
    } else {
      state.popoverKind = null;
      state.popoverId = null;
    }
    renderAll();
  }

  function selectFixture(fid, openPop) {
    state.selectedFixtureId = fid;
    state.selectedSwitchId = null;
    if (state.demoMode || (openPop && !isDesktopLayout())) {
      state.popoverKind = "fixture";
      state.popoverId = fid;
    } else {
      state.popoverKind = null;
      state.popoverId = null;
    }
    renderAll();
  }

  function handleSwitchClickOnPlan(swId, slotIdx, isStatusIconClick) {
    const sw = getSwitchById(swId);
    if (!sw) return;

    if (isMasterSwitch(sw)) {
      state.masterLightOn = !isMasterPowerActive();
      saveToStorage();
    } else {
      const keys = getEffectiveKeys(sw);

      if (typeof slotIdx === "number" && !Number.isNaN(slotIdx)) {
        if (keys[slotIdx]) {
          toggleKey(keys[slotIdx]);
        }
      } else if (isStatusIconClick) {
        if (keys.length === 1) {
          toggleKey(keys[0]);
        } else if (keys.length > 1) {
          const anyOn = keys.some((k) => isKeyOn(k));
          keys.forEach((k) => toggleKey(k, !anyOn));
        }
      } else if (keys.length === 1) {
        toggleKey(keys[0]);
      }
    }

    state.selectedSwitchId = sw.id;
    state.selectedFixtureId = null;
    if (state.demoMode) {
      state.popoverKind = "switch";
      state.popoverId = sw.id;
    } else if (!isDesktopLayout()) {
      if (state.popoverKind === "switch" && state.popoverId === sw.id) {
        state.popoverKind = null;
        state.popoverId = null;
      } else {
        state.popoverKind = "switch";
        state.popoverId = sw.id;
      }
    } else {
      state.popoverKind = null;
      state.popoverId = null;
    }
    renderAll();
  }

  function bindInteractiveActionHandlers(container) {
    container.querySelectorAll("[data-toggle-master-light]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        state.masterLightOn = !isMasterPowerActive();
        saveToStorage();
        renderAll();
      });
    });

    container.querySelectorAll("[data-reset-room-switches]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        Object.values(state.groupSettings).forEach((gs) => {
          gs.on = false;
        });
        saveToStorage();
        renderAll();
      });
    });

    container.querySelectorAll("[data-toggle-group]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleGroup(btn.getAttribute("data-toggle-group"));
        renderAll();
      });
    });

    container.querySelectorAll("[data-toggle-sw-key]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const sw = getSwitchById(btn.getAttribute("data-toggle-sw-key"));
        const idx = Number(btn.getAttribute("data-toggle-key-idx"));
        if (!sw) return;
        const eff = getEffectiveKeys(sw);
        if (eff[idx]) {
          toggleKey(eff[idx]);
          renderAll();
        }
      });
    });

    container.querySelectorAll("[data-panel-all]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const sw = getSwitchById(btn.getAttribute("data-panel-all"));
        const val = btn.getAttribute("data-val") === "1";
        if (sw) {
          getEffectiveKeys(sw).forEach((k) => toggleKey(k, val));
          renderAll();
        }
      });
    });

    container.querySelectorAll("[data-close-popover]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        state.popoverKind = null;
        state.popoverId = null;
        if (state.demoMode) {
          state.selectedSwitchId = null;
          state.selectedFixtureId = null;
          renderAll();
        } else {
          renderPopover();
        }
      });
    });

    container.querySelectorAll("[data-change-device-type]").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        const sw = getSwitchById(sel.getAttribute("data-change-device-type"));
        if (sw) {
          handleDeviceTypeChange(sw, e.target.value, sel);
        }
      });
    });

    container.querySelectorAll("[data-change-sw-room]").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        const sw = getSwitchById(sel.getAttribute("data-change-sw-room"));
        if (sw) {
          sw.room = e.target.value;
          saveToStorage();
          renderAll();
        }
      });
    });

    container.querySelectorAll("[data-unbind-sw]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        unbindKeyAtIndex(btn.getAttribute("data-unbind-sw"), Number(btn.getAttribute("data-unbind-idx")));
      });
    });

    container.querySelectorAll("[data-delete-sw]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-delete-sw");
        if (confirm(`Удалить выключатель ${id} с плана?`)) {
          deleteSwitch(id);
        }
      });
    });

    container.querySelectorAll("[data-start-link-from-sw]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        setMode("link");
        state.popoverKind = null;
        state.popoverId = null;
        renderPopover();
      });
    });

    container.querySelectorAll("[data-quick-bind-fx]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const fid = Number(btn.getAttribute("data-quick-bind-fx"));
        const sel = document.getElementById(btn.getAttribute("data-select-id"));
        if (sel && sel.value) {
          openBindModal(sel.value, fid);
        }
      });
    });

    container.querySelectorAll("[data-open-bind-pair]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const [swId, fidStr] = btn.getAttribute("data-open-bind-pair").split(":");
        openBindModal(swId, Number(fidStr));
      });
    });

    container.querySelectorAll("[data-dimmer-slider]").forEach((rng) => {
      rng.addEventListener("input", (e) => {
        const sw = getSwitchById(rng.getAttribute("data-dimmer-slider"));
        if (!sw) return;
        const val = Number(e.target.value);
        getEffectiveKeys(sw).forEach((k) => {
          getKeyTargetGroups(k).forEach((gid) => {
            const gs = ensureGroupSetting(gid);
            gs.brightness = val;
            gs.on = true;
            gs.scene = null;
          });
        });
        document.querySelectorAll(`[data-dimmer-label="${sw.id}"]`).forEach((lbl) => {
          lbl.textContent = `${val}%`;
        });
        renderFixturesGlow();
        renderFixtureHits();
        renderSwitchMarkers();
        renderStats();
      });
    });

    container.querySelectorAll("[data-rgb-color]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const sw = getSwitchById(btn.getAttribute("data-rgb-sw"));
        const col = btn.getAttribute("data-rgb-color");
        if (!sw) return;
        getEffectiveKeys(sw).forEach((k) => {
          getKeyTargetGroups(k).forEach((gid) => {
            const gs = ensureGroupSetting(gid);
            gs.color = col;
            gs.on = true;
            gs.scene = null;
          });
        });
        renderAll();
      });
    });

    container.querySelectorAll("[data-rgb-picker]").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        const sw = getSwitchById(inp.getAttribute("data-rgb-picker"));
        if (!sw) return;
        getEffectiveKeys(sw).forEach((k) => {
          getKeyTargetGroups(k).forEach((gid) => {
            const gs = ensureGroupSetting(gid);
            gs.color = e.target.value;
            gs.on = true;
            gs.scene = null;
          });
        });
        renderFixturesGlow();
        renderFixtureHits();
        renderSwitchMarkers();
        renderStats();
      });
      inp.addEventListener("change", () => renderAll());
    });

    // Live comment typing WITHOUT destroying focused textarea!
    container.querySelectorAll("[data-sw-comment]").forEach((ta) => {
      ta.addEventListener("input", (e) => {
        const swId = ta.getAttribute("data-sw-comment");
        const sw = getSwitchById(swId);
        if (!sw) return;
        sw.comment = e.target.value;
        saveToStorage();
        document.querySelectorAll(`[data-sw-comment="${swId}"]`).forEach((other) => {
          if (other !== ta) other.value = sw.comment;
        });
        document.querySelectorAll(`[data-comment-preview-sw="${swId}"]`).forEach((prev) => {
          const trimmed = sw.comment.trim();
          prev.style.display = trimmed ? "block" : "none";
          prev.textContent = trimmed ? `💬 ${trimmed}` : "";
        });
        renderSwitchMarkers();
        updateEditBadges();
        if (state.activeTab === "edits") renderSidebarTab();
      });
    });

    container.querySelectorAll("[data-fx-comment]").forEach((ta) => {
      ta.addEventListener("input", (e) => {
        const fid = Number(ta.getAttribute("data-fx-comment"));
        state.fixtureComments[fid] = e.target.value;
        saveToStorage();
        document.querySelectorAll(`[data-fx-comment="${fid}"]`).forEach((other) => {
          if (other !== ta) other.value = state.fixtureComments[fid];
        });
        renderFixtureHits();
        updateEditBadges();
        if (state.activeTab === "edits") renderSidebarTab();
      });
    });

    container.querySelectorAll("[data-focus-switch]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const swId = el.getAttribute("data-focus-switch");
        selectSwitch(swId, true);
        const sw = getSwitchById(swId);
        if (sw) panToPointIfNeeded(sw.x, sw.y);
      });
    });

    container.querySelectorAll("[data-focus-fixture]").forEach((el) => {
      el.addEventListener("click", () => {
        const fid = Number(el.getAttribute("data-focus-fixture"));
        selectFixture(fid, true);
        const f = fixturesById.get(fid);
        if (f) panToPointIfNeeded(f.cx, f.cy);
      });
    });

    container.querySelectorAll("[data-open-export]").forEach((btn) => {
      btn.addEventListener("click", openExportModal);
    });

    container.querySelectorAll("[data-swap-own-keys]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const swId = btn.getAttribute("data-swap-own-keys");
        const rawA = btn.getAttribute("data-swap-a");
        const rawB = btn.getAttribute("data-swap-b");
        const slotA = rawA !== null ? Number(rawA) : 0;
        const slotB = rawB !== null ? Number(rawB) : 1;
        swapKeys(swId, slotA, swId, slotB);
      });
    });

    // HTML5 drag-and-drop for keys in sidebar/popover
    container.querySelectorAll("[draggable='true'][data-drag-from-switch]").forEach((el) => {
      el.addEventListener("dragstart", (e) => {
        const fromSwId = el.getAttribute("data-drag-from-switch");
        const keyIndex = Number(el.getAttribute("data-drag-key-index"));
        sidebarDragPayload = { fromSwId, keyIndex };
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", `${fromSwId}:${keyIndex}`);
        }
        el.classList.add("is-dragging-key");
      });
      el.addEventListener("dragend", () => {
        sidebarDragPayload = null;
        el.classList.remove("is-dragging-key");
        clearAllDragHighlights();
      });
    });

    // Individual key drop targets -> swap places cleanly
    container.querySelectorAll("[data-drop-key-sw]").forEach((el) => {
      el.addEventListener("dragover", (e) => {
        if (!sidebarDragPayload) return;
        const toSwId = el.getAttribute("data-drop-key-sw");
        const toIdx = Number(el.getAttribute("data-drop-key-idx"));
        if (toSwId === sidebarDragPayload.fromSwId && toIdx === sidebarDragPayload.keyIndex) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        document.querySelectorAll(".is-drop-target, .is-swap-target").forEach((n) => {
          if (n !== el) n.classList.remove("is-drop-target", "is-swap-target");
        });
        el.classList.add("is-swap-target");
      });
      el.addEventListener("dragleave", (e) => {
        if (!el.contains(e.relatedTarget)) el.classList.remove("is-swap-target");
      });
      el.addEventListener("drop", (e) => {
        if (!sidebarDragPayload) return;
        const toSwId = el.getAttribute("data-drop-key-sw");
        const toIdx = Number(el.getAttribute("data-drop-key-idx"));
        if (toSwId === sidebarDragPayload.fromSwId && toIdx === sidebarDragPayload.keyIndex) return;
        e.preventDefault();
        e.stopPropagation();
        const { fromSwId, keyIndex } = sidebarDragPayload;
        sidebarDragPayload = null;
        clearAllDragHighlights();
        swapKeys(fromSwId, keyIndex, toSwId, toIdx);
      });
    });

    // Empty slot drop targets -> place into free slot or swap within same switch
    container.querySelectorAll("[data-drop-empty-sw]").forEach((el) => {
      el.addEventListener("dragover", (e) => {
        if (!sidebarDragPayload) return;
        const toSwId = el.getAttribute("data-drop-empty-sw");
        const rawSlot = el.getAttribute("data-drop-empty-slot");
        const targetSlot = rawSlot !== null ? Number(rawSlot) : 1;
        if (sidebarDragPayload.fromSwId === toSwId && sidebarDragPayload.keyIndex === targetSlot) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        document.querySelectorAll(".is-drop-target, .is-swap-target").forEach((n) => {
          if (n !== el) n.classList.remove("is-drop-target", "is-swap-target");
        });
        el.classList.add("is-drop-target");
      });
      el.addEventListener("dragleave", (e) => {
        if (!el.contains(e.relatedTarget)) el.classList.remove("is-drop-target");
      });
      el.addEventListener("drop", (e) => {
        if (!sidebarDragPayload) return;
        const toSwId = el.getAttribute("data-drop-empty-sw");
        const rawSlot = el.getAttribute("data-drop-empty-slot");
        const targetSlot = rawSlot !== null ? Number(rawSlot) : 1;
        const resolvedSlot = Number.isNaN(targetSlot) ? 1 : targetSlot;
        if (sidebarDragPayload.fromSwId === toSwId && sidebarDragPayload.keyIndex === resolvedSlot) return;
        e.preventDefault();
        e.stopPropagation();
        const { fromSwId, keyIndex } = sidebarDragPayload;
        sidebarDragPayload = null;
        clearAllDragHighlights();
        if (fromSwId === toSwId) {
          swapKeys(fromSwId, keyIndex, toSwId, resolvedSlot);
        } else {
          executeMoveKey(fromSwId, keyIndex, toSwId, "append", resolvedSlot);
        }
      });
    });

    container.querySelectorAll("[data-card-switch]").forEach((card) => {
      card.addEventListener("dragover", (e) => {
        if (!sidebarDragPayload) return;
        const targetId = card.getAttribute("data-card-switch");
        const targetSw = getSwitchById(targetId);
        if (!targetSw || isMasterSwitch(targetSw) || targetId === sidebarDragPayload.fromSwId) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        document.querySelectorAll(".is-drop-target, .is-swap-target").forEach((n) => {
          if (n !== card) n.classList.remove("is-drop-target", "is-swap-target");
        });
        card.classList.add("is-drop-target");
      });
      card.addEventListener("dragleave", (e) => {
        if (!card.contains(e.relatedTarget)) card.classList.remove("is-drop-target");
      });
      card.addEventListener("drop", (e) => {
        if (!sidebarDragPayload) return;
        const targetId = card.getAttribute("data-card-switch");
        const targetSw = getSwitchById(targetId);
        if (!targetSw || isMasterSwitch(targetSw)) return;
        e.preventDefault();
        const { fromSwId, keyIndex } = sidebarDragPayload;
        sidebarDragPayload = null;
        clearAllDragHighlights();
        moveKeyToSwitch(fromSwId, keyIndex, targetId);
      });
    });
  }

  function clearAllDragHighlights() {
    document.querySelectorAll(".is-drop-target, .is-swap-target").forEach((n) => {
      n.classList.remove("is-drop-target", "is-swap-target");
    });
  }

  /* ==================== CANVAS WIRE DRAG & SWITCH MARKER EVENTS ==================== */

  function screenToStage(clientX, clientY) {
    const vpRect = viewportEl.getBoundingClientRect();
    return {
      x: (clientX - vpRect.left - state.panX) / state.zoom,
      y: (clientY - vpRect.top - state.panY) / state.zoom
    };
  }

  function findDropTargetAt(clientX, clientY, sourceKind) {
    const stagePt = screenToStage(clientX, clientY);
    if (sourceKind === "switch") {
      // Find nearest fixture within 60px in stage coords
      let best = null;
      let bestD = 60;
      DATA.fixtures.forEach((f) => {
        const d = Math.hypot(stagePt.x - f.cx, stagePt.y - f.cy);
        if (d < bestD) {
          bestD = d;
          best = f.id;
        }
      });
      return best ? { kind: "fixture", id: best, x: fixturesById.get(best).cx, y: fixturesById.get(best).cy } : null;
    } else {
      const els = document.elementsFromPoint(clientX, clientY);
      for (const node of els) {
        const marker = node.closest && node.closest(".switch-marker");
        if (marker) {
          const sw = getSwitchById(marker.dataset.switchId);
          const slotNode = node.closest && node.closest("[data-key-slot]");
          if (sw && !isMasterSwitch(sw)) {
            return {
              kind: "switch",
              id: sw.id,
              x: sw.x,
              y: sw.y,
              slotIdx: slotNode ? Number(slotNode.getAttribute("data-key-slot")) : null
            };
          }
        }
      }
      // Proximity fallback within 80px in stage coords
      let best = null;
      let bestD = 80;
      state.switches.forEach((sw) => {
        if (isMasterSwitch(sw)) return;
        const d = Math.hypot(stagePt.x - sw.x, stagePt.y - sw.y);
        if (d < bestD) {
          bestD = d;
          best = sw;
        }
      });
      return best ? { kind: "switch", id: best.id, x: best.x, y: best.y, slotIdx: null } : null;
    }
  }

  function startWireDrag(sourceKind, sourceId, originX, originY, downX, downY, onCancelledClick, sourceSlotIdx) {
    let active = false;
    let currentTarget = null;

    function onMove(mv) {
      const dist = Math.hypot(mv.clientX - downX, mv.clientY - downY);
      if (!active && dist > 6) {
        active = true;
      }
      if (!active) return;

      const pt = screenToStage(mv.clientX, mv.clientY);
      currentTarget = findDropTargetAt(mv.clientX, mv.clientY, sourceKind);

      document.querySelectorAll(".is-drop-target, .is-swap-target").forEach((n) => {
        n.classList.remove("is-drop-target", "is-swap-target");
      });
      if (currentTarget) {
        if (currentTarget.kind === "fixture") {
          const hit = fixtureHitsLayerEl.querySelector(`[data-fixture-id="${currentTarget.id}"]`);
          if (hit) hit.classList.add("is-drop-target");
        } else {
          const swEl = switchesLayerEl.querySelector(`[data-switch-id="${currentTarget.id}"]`);
          if (swEl) {
            swEl.classList.add("is-drop-target");
            if (typeof currentTarget.slotIdx === "number") {
              const slotEl = swEl.querySelector(`[data-key-slot="${currentTarget.slotIdx}"]`);
              if (slotEl) slotEl.classList.add("is-swap-target");
            }
          }
        }
      }

      const endX = currentTarget ? currentTarget.x : pt.x;
      const endY = currentTarget ? currentTarget.y : pt.y;
      dragWireLayerEl.innerHTML = "";
      dragWireLayerEl.appendChild(
        createSvgEl("line", {
          x1: originX,
          y1: originY,
          x2: endX,
          y2: endY,
          stroke: currentTarget ? "#16a34a" : "#2563eb",
          "stroke-width": 5,
          "stroke-dasharray": currentTarget ? "none" : "10 7",
          "stroke-linecap": "round"
        })
      );
      dragWireLayerEl.appendChild(
        createSvgEl("circle", {
          cx: endX,
          cy: endY,
          r: 10,
          fill: currentTarget ? "#16a34a" : "#2563eb"
        })
      );
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      dragWireLayerEl.innerHTML = "";
      document.querySelectorAll(".is-drop-target, .is-swap-target").forEach((n) => {
        n.classList.remove("is-drop-target", "is-swap-target");
      });

      if (active) {
        suppressNextClick = true;
        setTimeout(() => {
          suppressNextClick = false;
        }, 60);
        if (currentTarget) {
          if (sourceKind === "switch") openBindModal(sourceId, currentTarget.id, sourceSlotIdx);
          else openBindModal(currentTarget.id, sourceId, currentTarget.slotIdx);
        }
      } else if (onCancelledClick) {
        onCancelledClick();
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function bindFixtureHitEvents(hitEl, f) {
    hitEl.addEventListener("click", (e) => {
      e.stopPropagation();
      if (suppressNextClick) return;
      selectFixture(f.id, true);
    });

    hitEl.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || state.mode !== "link") return;
      e.stopPropagation();
      startWireDrag("fixture", f.id, f.cx, f.cy, e.clientX, e.clientY);
    });
  }

  function bindSwitchMarkerEvents(el, linkHandle, sw) {
    el.addEventListener("mouseenter", () => {
      state.hoveredSwitchId = sw.id;
      renderTempLinks();
    });

    el.addEventListener("mouseleave", () => {
      if (state.hoveredSwitchId === sw.id) {
        state.hoveredSwitchId = null;
        renderTempLinks();
      }
    });

    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (suppressNextClick) return;
      const slotEl = e.target.closest("[data-key-slot]");
      const slotIdx = slotEl ? Number(slotEl.getAttribute("data-key-slot")) : null;
      const isStatusIcon = !!e.target.closest(".sw-status-icon");
      handleSwitchClickOnPlan(sw.id, slotIdx, isStatusIcon);
    });

    el.addEventListener("dragover", (e) => {
      if (!sidebarDragPayload || isMasterSwitch(sw)) return;
      const slotEl = e.target.closest("[data-key-slot]");
      if (slotEl) {
        const slotIdx = Number(slotEl.getAttribute("data-key-slot"));
        if (sw.id === sidebarDragPayload.fromSwId && slotIdx === sidebarDragPayload.keyIndex) return;
        const eff = getEffectiveKeys(sw);
        const dt = getEffectiveDeviceType(sw);
        if (sw.id === sidebarDragPayload.fromSwId && !eff[slotIdx] && dt.maxRecommendedKeys < 2) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        document.querySelectorAll(".is-drop-target, .is-swap-target").forEach((n) => {
          if (n !== slotEl) n.classList.remove("is-drop-target", "is-swap-target");
        });
        slotEl.classList.add("is-swap-target");
        return;
      }
      if (sw.id === sidebarDragPayload.fromSwId) {
        if (getEffectiveKeys(sw).length >= 2) {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
          document.querySelectorAll(".is-drop-target, .is-swap-target").forEach((n) => {
            if (n !== el) n.classList.remove("is-drop-target", "is-swap-target");
          });
          el.classList.add("is-drop-target");
        }
        return;
      }
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      document.querySelectorAll(".is-drop-target, .is-swap-target").forEach((n) => {
        if (n !== el) n.classList.remove("is-drop-target", "is-swap-target");
      });
      el.classList.add("is-drop-target");
    });
    el.addEventListener("dragleave", (e) => {
      if (!el.contains(e.relatedTarget)) {
        el.classList.remove("is-drop-target");
        el.querySelectorAll(".is-swap-target").forEach((n) => n.classList.remove("is-swap-target"));
      }
    });
    el.addEventListener("drop", (e) => {
      if (!sidebarDragPayload || isMasterSwitch(sw)) return;
      e.preventDefault();
      const { fromSwId, keyIndex } = sidebarDragPayload;
      sidebarDragPayload = null;
      const slotEl = e.target.closest("[data-key-slot]");
      clearAllDragHighlights();
      if (slotEl) {
        const slotIdx = Number(slotEl.getAttribute("data-key-slot"));
        const eff = getEffectiveKeys(sw);
        if (eff[slotIdx] && !isEmptyKey(eff[slotIdx])) {
          if (!(fromSwId === sw.id && keyIndex === slotIdx)) {
            swapKeys(fromSwId, keyIndex, sw.id, slotIdx);
          }
        } else if (fromSwId !== sw.id) {
          executeMoveKey(fromSwId, keyIndex, sw.id, "append", slotIdx);
        } else {
          swapKeys(fromSwId, keyIndex, sw.id, slotIdx);
        }
      } else if (fromSwId === sw.id) {
        const len = Math.max(getEffectiveKeys(sw).length, getEffectiveDeviceType(sw).maxRecommendedKeys);
        if (len >= 2) {
          swapKeys(sw.id, keyIndex, sw.id, (keyIndex + 1) % len);
        }
      } else {
        moveKeyToSwitch(fromSwId, keyIndex, sw.id);
      }
    });

    if (linkHandle) {
      linkHandle.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || isMasterSwitch(sw)) return;
        e.stopPropagation();
        startWireDrag("switch", sw.id, sw.x, sw.y, e.clientX, e.clientY);
      });
    }

    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.isPrimary === false) return;
      if (e.target.closest(".sw-link-handle")) return;
      e.stopPropagation();
      if (state.demoMode) return;

      if (state.mode === "link") {
        if (isMasterSwitch(sw)) return;
        const slotEl = e.target.closest("[data-key-slot]");
        const srcSlot = slotEl ? Number(slotEl.getAttribute("data-key-slot")) : null;
        startWireDrag("switch", sw.id, sw.x, sw.y, e.clientX, e.clientY, null, srcSlot);
        return;
      }

      // Normal mode: move switch marker on wall (wider threshold on touch to keep taps crisp)
      const downPointerId = e.pointerId;
      const downX = e.clientX;
      const downY = e.clientY;
      const origX = sw.x;
      const origY = sw.y;
      const dragThreshold = e.pointerType === "touch" ? 14 : 5;
      let isDragging = false;

      function onMultiTouch(ts) {
        if (ts.touches && ts.touches.length > 1) {
          isDragging = false;
          sw.x = origX;
          sw.y = origY;
          el.style.left = `${sw.x}px`;
          el.style.top = `${sw.y}px`;
          renderTempLinks();
          cleanup();
        }
      }

      function onMove(mv) {
        if (mv.pointerId !== downPointerId) return;
        const dxScreen = mv.clientX - downX;
        const dyScreen = mv.clientY - downY;
        if (!isDragging && Math.hypot(dxScreen, dyScreen) > dragThreshold) {
          isDragging = true;
          el.classList.add("is-dragging");
          state.selectedSwitchId = sw.id;
          state.selectedFixtureId = null;
          state.hoveredSwitchId = sw.id;
        }
        if (isDragging) {
          sw.x = Math.round(Math.max(40, Math.min(DATA.plan.width - 40, origX + dxScreen / state.zoom)));
          sw.y = Math.round(Math.max(40, Math.min(DATA.plan.height - 40, origY + dyScreen / state.zoom)));
          el.style.left = `${sw.x}px`;
          el.style.top = `${sw.y}px`;
          renderTempLinks();
          if (state.popoverKind === "switch" && state.popoverId === sw.id) {
            positionPopoverNearPlanPoint(sw.x, sw.y);
          }
        }
      }

      function cleanup() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        window.removeEventListener("touchstart", onMultiTouch);
        el.classList.remove("is-dragging");
      }

      function onUp(upEv) {
        if (upEv && upEv.pointerId !== undefined && upEv.pointerId !== downPointerId) return;
        cleanup();
        if (isDragging) {
          suppressNextClick = true;
          setTimeout(() => {
            suppressNextClick = false;
          }, 60);
          saveToStorage();
          renderAll();
        }
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      window.addEventListener("touchstart", onMultiTouch, { passive: true });
    });
  }

  /* ==================== PAN & ZOOM ==================== */

  function applyTransform() {
    stageEl.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    zoomReadoutEl.textContent = `${Math.round(state.zoom * 100)}%`;
    if (state.popoverKind === "switch" && state.popoverId) {
      const sw = getSwitchById(state.popoverId);
      if (sw) positionPopoverNearPlanPoint(sw.x, sw.y);
    } else if (state.popoverKind === "fixture" && state.popoverId) {
      const f = fixturesById.get(state.popoverId);
      if (f) positionPopoverNearPlanPoint(f.cx, f.cy);
    }
  }

  function fitPlanToViewport() {
    const vpRect = viewportEl.getBoundingClientRect();
    if (!vpRect.width || !vpRect.height) return;

    const b = DATA.plan.apartmentBounds;
    const bw = b.maxX - b.minX;
    const bh = b.maxY - b.minY;
    const topPad = 24;
    const bottomPad = 60;
    const sidePad = 28;
    const availW = vpRect.width - sidePad * 2;
    const availH = vpRect.height - topPad - bottomPad;
    const scale = Math.min(availW / bw, availH / bh);
    state.zoom = Math.max(0.25, Math.min(1.4, scale));

    const centerX = (b.minX + b.maxX) / 2;
    const centerY = (b.minY + b.maxY) / 2;
    const availCenterY = topPad + availH / 2;
    state.panX = vpRect.width / 2 - centerX * state.zoom;
    state.panY = availCenterY - centerY * state.zoom;
    applyTransform();
  }

  function zoomAtPoint(factor, clientX, clientY) {
    const vpRect = viewportEl.getBoundingClientRect();
    const vx = clientX - vpRect.left;
    const vy = clientY - vpRect.top;

    const newZoom = Math.max(0.25, Math.min(2.6, state.zoom * factor));
    const ratio = newZoom / state.zoom;
    state.panX = vx - (vx - state.panX) * ratio;
    state.panY = vy - (vy - state.panY) * ratio;
    state.zoom = newZoom;
    applyTransform();
  }

  function panToPointIfNeeded(px, py) {
    const vpRect = viewportEl.getBoundingClientRect();
    const sx = px * state.zoom + state.panX;
    const sy = py * state.zoom + state.panY;
    const margin = 80;
    if (sx < margin || sx > vpRect.width - margin || sy < margin || sy > vpRect.height - margin) {
      state.panX = vpRect.width / 2 - px * state.zoom;
      state.panY = vpRect.height / 2 - py * state.zoom;
      applyTransform();
    }
  }

  viewportEl.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      zoomAtPoint(factor, e.clientX, e.clientY);
    },
    { passive: false }
  );

  viewportEl.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") return; // handled by multi-touch handlers below
    if (e.button !== 0) return;
    if (
      e.target.closest(".switch-marker") ||
      e.target.closest(".fixture-hit") ||
      e.target.closest(".switch-popover") ||
      e.target.closest(".zoom-controls") ||
      e.target.closest(".floating-legend") ||
      e.target.closest(".link-mode-banner") ||
      e.target.closest(".master-off-banner")
    ) {
      return;
    }

    const downX = e.clientX;
    const downY = e.clientY;
    const startPanX = state.panX;
    const startPanY = state.panY;
    let moved = false;

    viewportEl.classList.add("is-panning");

    function onMove(mv) {
      const dx = mv.clientX - downX;
      const dy = mv.clientY - downY;
      if (!moved && Math.hypot(dx, dy) > 4) moved = true;
      if (moved) {
        state.panX = startPanX + dx;
        state.panY = startPanY + dy;
        applyTransform();
      }
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      viewportEl.classList.remove("is-panning");
      if (!moved) {
        state.popoverKind = null;
        state.popoverId = null;
        state.selectedSwitchId = null;
        state.selectedFixtureId = null;
        renderAll();
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  });

  // Touchscreen 1-finger pan + 2-finger pinch-to-zoom on canvas viewport
  let touchGesture = null;

  function isUiOverlayTarget(target) {
    return !!(
      target &&
      target.closest &&
      (target.closest(".switch-popover") ||
        target.closest(".zoom-controls") ||
        target.closest(".floating-legend") ||
        target.closest(".link-mode-banner") ||
        target.closest(".master-off-banner"))
    );
  }

  viewportEl.addEventListener(
    "touchstart",
    (e) => {
      if (isUiOverlayTarget(e.target)) return;

      if (e.touches.length === 2) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) || 1;
        const cx = (t0.clientX + t1.clientX) / 2;
        const cy = (t0.clientY + t1.clientY) / 2;
        touchGesture = { mode: "pinch", dist, cx, cy, moved: true };
        return;
      }

      if (e.touches.length === 1) {
        if (e.target.closest(".switch-marker") || e.target.closest(".fixture-hit")) {
          touchGesture = null;
          return;
        }
        const t = e.touches[0];
        touchGesture = {
          mode: "pan",
          startX: t.clientX,
          startY: t.clientY,
          startPanX: state.panX,
          startPanY: state.panY,
          moved: false
        };
      }
    },
    { passive: true }
  );

  viewportEl.addEventListener(
    "touchmove",
    (e) => {
      if (!touchGesture || isUiOverlayTarget(e.target)) return;

      if (touchGesture.mode === "pinch" && e.touches.length === 2) {
        e.preventDefault();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) || 1;
        const cx = (t0.clientX + t1.clientX) / 2;
        const cy = (t0.clientY + t1.clientY) / 2;

        const factor = dist / touchGesture.dist;
        state.panX += cx - touchGesture.cx;
        state.panY += cy - touchGesture.cy;
        zoomAtPoint(factor, cx, cy);

        touchGesture.dist = dist;
        touchGesture.cx = cx;
        touchGesture.cy = cy;
        return;
      }

      if (touchGesture.mode === "pan" && e.touches.length === 1) {
        const t = e.touches[0];
        const dx = t.clientX - touchGesture.startX;
        const dy = t.clientY - touchGesture.startY;
        if (!touchGesture.moved && Math.hypot(dx, dy) > 6) {
          touchGesture.moved = true;
        }
        if (touchGesture.moved) {
          e.preventDefault();
          state.panX = touchGesture.startPanX + dx;
          state.panY = touchGesture.startPanY + dy;
          applyTransform();
        }
      }
    },
    { passive: false }
  );

  function finishTouchGesture(e) {
    if (!touchGesture) return;
    if (e.touches && e.touches.length === 1 && touchGesture.mode === "pinch") {
      const t = e.touches[0];
      touchGesture = {
        mode: "pan",
        startX: t.clientX,
        startY: t.clientY,
        startPanX: state.panX,
        startPanY: state.panY,
        moved: true
      };
      return;
    }
    if (!e.touches || e.touches.length === 0) {
      const wasTap = touchGesture.mode === "pan" && !touchGesture.moved;
      touchGesture = null;
      if (wasTap) {
        state.popoverKind = null;
        state.popoverId = null;
        state.selectedSwitchId = null;
        state.selectedFixtureId = null;
        renderAll();
      }
    }
  }

  viewportEl.addEventListener("touchend", finishTouchGesture, { passive: true });
  viewportEl.addEventListener("touchcancel", () => {
    touchGesture = null;
  });

  document.getElementById("btn-zoom-in").addEventListener("click", () => {
    const r = viewportEl.getBoundingClientRect();
    zoomAtPoint(1.2, r.left + r.width / 2, r.top + r.height / 2);
  });

  document.getElementById("btn-zoom-out").addEventListener("click", () => {
    const r = viewportEl.getBoundingClientRect();
    zoomAtPoint(0.83, r.left + r.width / 2, r.top + r.height / 2);
  });

  document.getElementById("btn-zoom-fit").addEventListener("click", fitPlanToViewport);

  /* ==================== TOPBAR & TABS ==================== */

  function setMode(mode) {
    state.mode = mode;
    btnModeNormal.classList.toggle("is-active", mode === "normal");
    btnModeLink.classList.toggle("is-active", mode === "link");
    linkModeBanner.classList.toggle("is-hidden", mode !== "link");
    viewportEl.classList.toggle("is-link-mode", mode === "link");
  }

  function setVariant(variant) {
    state.variant = variant;
    if (btnVariantA) btnVariantA.classList.toggle("is-active", variant === "A");
    if (btnVariantB) btnVariantB.classList.toggle("is-active", variant === "B");
    saveToStorage();
    renderAll();
  }

  function setDemoMode(enabled) {
    state.demoMode = !!enabled;
    document.body.classList.toggle("is-demo-mode", state.demoMode);
    if (state.demoMode) {
      setMode("normal");
    }
    if (btnToggleEditorEl) {
      btnToggleEditorEl.textContent = state.demoMode ? "⚙️ Редактор" : "📱 Демо-режим";
    }
    renderAll();
    requestAnimationFrame(fitPlanToViewport);
  }

  btnModeNormal.addEventListener("click", () => setMode("normal"));
  btnModeLink.addEventListener("click", () => setMode("link"));
  document.getElementById("btn-exit-link-mode").addEventListener("click", () => setMode("normal"));
  if (btnToggleDimsEl) {
    btnToggleDimsEl.addEventListener("click", () => {
      state.showDims = !state.showDims;
      btnToggleDimsEl.classList.toggle("is-active", state.showDims);
      renderPlanAdditions();
    });
  }
  if (btnToggleEditorEl) {
    btnToggleEditorEl.addEventListener("click", () => setDemoMode(!state.demoMode));
  }
  if (btnRestoreMasterEl) {
    btnRestoreMasterEl.addEventListener("click", () => {
      state.masterLightOn = true;
      saveToStorage();
      renderAll();
    });
  }

  if (btnVariantA) btnVariantA.addEventListener("click", () => setVariant("A"));
  if (btnVariantB) btnVariantB.addEventListener("click", () => setVariant("B"));

  document.getElementById("btn-add-switch").addEventListener("click", openAddSwitchModal);
  document.getElementById("btn-export-edits").addEventListener("click", openExportModal);

  document.getElementById("btn-lights-off").addEventListener("click", () => {
    Object.values(state.groupSettings).forEach((gs) => {
      gs.on = false;
    });
    state.masterLightOn = true;
    saveToStorage();
    renderAll();
  });

  if (btnUndoLightEl) {
    btnUndoLightEl.addEventListener("click", undoLightingAction);
  }

  window.addEventListener("keydown", (e) => {
    if (e.target && e.target.matches("input, textarea, select")) return;
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const kLow = e.key ? e.key.toLowerCase() : "";
      const isZ = e.code === "KeyZ" || kLow === "z" || kLow === "я";
      const isY = !e.metaKey && e.ctrlKey && (e.code === "KeyY" || kLow === "y" || kLow === "н");
      if (isZ && !e.shiftKey) {
        if (lightingUndoStack.length) {
          e.preventDefault();
          undoLightingAction();
        }
      } else if ((isZ && e.shiftKey) || isY) {
        if (lightingRedoStack.length) {
          e.preventDefault();
          redoLightingAction();
        }
      }
    }
  });

  document.getElementById("btn-reset-edits").addEventListener("click", () => {
    if (!confirm("Сбросить все ваши перестановки, типы механизмов, привязки и комментарии к актуальной схеме BM, B1–B25?")) {
      return;
    }
    const preResetSnap = lastSavedLightingSnap || captureLightingSnap();
    lightingUndoStack.push(preResetSnap);
    if (lightingUndoStack.length > MAX_LIGHTING_HISTORY) lightingUndoStack.shift();
    lightingRedoStack.length = 0;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
    state.variant = "A";
    state.masterLightOn = true;
    state.masterSwitchDeleted = false;
    state.showDims = false;
    state.groups = deepClone(BASELINE_GROUPS);
    state.switches = deepClone(BASELINE_SWITCHES);
    state.groupSettings = buildInitialGroupSettings(state.groups);
    state.fixtureComments = {};
    state.selectedSwitchId = null;
    state.selectedFixtureId = null;
    state.popoverKind = null;
    state.popoverId = null;
    if (btnToggleDimsEl) btnToggleDimsEl.classList.remove("is-active");
    if (btnVariantA) btnVariantA.classList.add("is-active");
    if (btnVariantB) btnVariantB.classList.remove("is-active");
    lastSavedLightingSnap = captureLightingSnap();
    updateLightingUndoUI();
    renderAll();
  });

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      state.activeTab = tab;
      document.querySelectorAll(".tab-btn").forEach((b) => {
        const active = b.getAttribute("data-tab") === tab;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-selected", active ? "true" : "false");
      });
      renderSidebarTab();
    });
  });

  window.addEventListener("resize", () => {
    if (state.popoverKind === "switch" && state.popoverId) {
      const sw = getSwitchById(state.popoverId);
      if (sw) positionPopoverNearPlanPoint(sw.x, sw.y);
    } else if (state.popoverKind === "fixture" && state.popoverId) {
      const f = fixturesById.get(state.popoverId);
      if (f) positionPopoverNearPlanPoint(f.cx, f.cy);
    }
  });

  // Boot
  loadFromStorage();
  lastSavedLightingSnap = captureLightingSnap();
  updateLightingUndoUI();
  document.body.classList.toggle("is-demo-mode", state.demoMode);
  if (btnToggleEditorEl) {
    btnToggleEditorEl.textContent = state.demoMode ? "⚙️ Редактор" : "📱 Демо-режим";
  }
  renderFloatingLegend();
  if (btnToggleDimsEl) btnToggleDimsEl.classList.toggle("is-active", !!state.showDims);
  if (btnVariantA) btnVariantA.classList.toggle("is-active", state.variant === "A");
  if (btnVariantB) btnVariantB.classList.toggle("is-active", state.variant === "B");
  renderAll();
  requestAnimationFrame(fitPlanToViewport);
  const planImgEl = document.getElementById("plan-image");
  if (planImgEl && !planImgEl.complete) {
    planImgEl.addEventListener("load", () => requestAnimationFrame(fitPlanToViewport), { once: true });
  }
})();
