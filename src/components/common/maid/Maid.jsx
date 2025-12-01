import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Application, Ticker } from 'pixi.js';
import '../../../styles/common/aimaid/Maid.css';
import MaidAiChat from './MaidAiChat';
import Header from './components/Header';
import Splitter from './components/Splitter';
import CanvasArea from './components/CanvasArea';
import ControlBar from './components/ControlBar';
import SettingsPanel from './components/SettingsPanel';
import EmotionPanel from './components/EmotionPanel';
import ExpandHandle from './components/ExpandHandle';
import { DEFAULT_CONFIG_KEY, modelConfigs, RATIO_MIN, RATIO_MAX, WIDTH_KEY as WIDTH_KEY_CONST, SPLIT_KEY as SPLIT_KEY_CONST, MIN_TOP_PX as MIN_TOP_PX_CONST, MIN_BOTTOM_PX as MIN_BOTTOM_PX_CONST } from './constants';
import { Live2DModel } from 'pixi-live2d-display/cubism4';

// 确保 Live2D 使用 Pixi 的全局 Ticker 驱动动画（需要传入 Ticker 类，而非实例）
if (!Live2DModel._tickerRegistered) {
  Live2DModel.registerTicker(Ticker);
  // 标记避免重复注册（非公开属性，仅内部使用）
  Live2DModel._tickerRegistered = true;
}

// 确保在使用 pixi-live2d-display 之前已加载 Cubism Core
async function ensureCubismCoreReady() {
  if (typeof window === 'undefined') return;
  if (window.Live2DCubismCore) return; // 已有全局对象
  // 若 index.html 未成功加载，降级为运行时注入
  const existing = document.getElementById('live2dcubismcore-script');
  if (existing) {
    await new Promise((resolve) => existing.addEventListener('load', resolve, { once: true }));
    return;
  }
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/live2dsrc/live2dcubismcore.min.js';
    s.async = true;
    s.id = 'live2dcubismcore-script';
    s.onload = () => resolve();
    s.onerror = (e) => reject(e);
    document.head.appendChild(s);
  });
}

export default function Maid() {
  const containerRef = useRef(null);
  const appRef = useRef(null);
  const modelRef = useRef(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const preloadedRef = useRef(new Map());
  const modelUrlRef = useRef('');
  const expJsonCacheRef = useRef(new Map());
  const compositeTargetRef = useRef(new Map());
  const enforcerOnRef = useRef(false);
  const enforcerFnRef = useRef(null);
  const [collapsed, setCollapsed] = useState(false);
  const WIDTH_KEY = WIDTH_KEY_CONST;
  const [panelWidth, setPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return 360;
    try {
      const saved = localStorage.getItem(WIDTH_KEY);
      const w = saved ? parseInt(saved, 10) : Math.round(window.innerWidth * 0.25);
      const minW = 220; const maxW = Math.max(minW, window.innerWidth - 80);
      return Math.min(Math.max(w || 360, minW), maxW);
    } catch {
      return Math.round(window.innerWidth * 0.25);
    }
  });
  const [dpi, setDpi] = useState(3);
  const [userScale] = useState(1); // UI 不再暴露
  const basePosRef = useRef({ x: 0, y: 0 });
  const offsetRef = useRef({ x: 0, y: 0 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [innerHeight, setInnerHeight] = useState(0);
  const SPLIT_KEY = SPLIT_KEY_CONST;
  const [splitRatio, setSplitRatio] = useState(() => {
    if (typeof window === 'undefined') return 0.5;
    const s = localStorage.getItem(SPLIT_KEY);
    const n = s ? parseFloat(s) : 0.5; if (!Number.isFinite(n)) return 0.5; return Math.min(RATIO_MAX, Math.max(RATIO_MIN, n));
  });
  const [controlbarH, setControlbarH] = useState(0);
  const MIN_TOP_PX = MIN_TOP_PX_CONST;
  const MIN_BOTTOM_PX = MIN_BOTTOM_PX_CONST;
  

  const [selectedExpression, setSelectedExpression] = useState('');
  const [selectedClothes, setSelectedClothes] = useState([]);
  const [selectedAction, setSelectedAction] = useState('');
  const [selectedScene, setSelectedScene] = useState('');
  const [openPanel, setOpenPanel] = useState('');

  const [currentModelKey, setCurrentModelKey] = useState(DEFAULT_CONFIG_KEY);
  const getCurrentConfig = useCallback(
    () => modelConfigs[currentModelKey] || modelConfigs[DEFAULT_CONFIG_KEY],
    [currentModelKey],
  );

  const getCategorizedExpressions = useCallback(() => {
    const cfg = modelConfigs[currentModelKey] || modelConfigs[DEFAULT_CONFIG_KEY];
    return cfg.expressions;
  }, [currentModelKey]);

  const fitAndPlace = useCallback(() => {
    const app = appRef.current;
    const container = containerRef.current;
    const model = modelRef.current;
    if (!app || !container || !model || !app.renderer) return;

    const canvasEl =
      container.querySelector('.maid-canvas-area .maid-canvas-wrap') ||
      container.querySelector('.maid-canvas-wrap');
    const viewW = (canvasEl && canvasEl.clientWidth) || 300;
    const viewH = (canvasEl && canvasEl.clientHeight) || 400;

    // 使用 pixi-live2d 内部计算出的模型基准宽高来自适应，而不是 CanvasInfo（单位差异会导致过大）
    const baseW = Number(model?.internalModel?.width) || 1;
    const baseH = Number(model?.internalModel?.height) || 1;
    let finalScale = Math.min(viewW / baseW, viewH / baseH) * 0.95;
    if (!Number.isFinite(finalScale) || finalScale <= 0) finalScale = 0.35;
    finalScale = Math.max(0.01, finalScale * (Number(userScale) || 1));

    if (model.anchor && typeof model.anchor.set === 'function') model.anchor.set(0.5, 0.5);
    model.scale.set(finalScale, finalScale);
    const baseX = viewW / 2;
    const scaledH = baseH * finalScale;
    const bottomMargin = 8;
    const baseY = Math.max(scaledH / 2 + bottomMargin, viewH - bottomMargin - (scaledH / 2));
    basePosRef.current = { x: baseX, y: baseY };
    model.x = baseX + (offsetRef.current?.x || 0);
    model.y = baseY + (offsetRef.current?.y || 0);
  }, [userScale]);

  const startIdle = useCallback(async (model) => {
    if (!model) return false;
    let groups = [];
    try {
      const settings = model?.internalModel?.settings || model?.internalModel?._settings;
      const motions = settings?.motions || settings?.Motions || settings?._motions;
      if (motions && typeof motions === 'object') groups = Object.keys(motions);
    } catch { /* ignore */ }
    if (!groups.length) return false;
    const exactPref = ['Idle', 'idle', 'IDLE', '待机', '待机动画', '待機'];
    let group = exactPref.find((g) => groups.includes(g));
    if (!group) group = groups.find((g) => /idle|待机|待機/i.test(g));
    if (!group) return false;
    try {
      try { model?.internalModel?.motionManager?.stopAllMotions?.(); } catch { /* ignore */ }
      await model.motion(group);
      return true;
    } catch { /* ignore */ }
    return false;
  }, []);

  const fitAndPlaceMemo = useCallback(() => { try { fitAndPlace(); } catch { /* ignore */ } }, [fitAndPlace]);

  // 初始化 Pixi 应用并挂载到 CanvasArea 的 .maid-canvas-wrap
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const container = containerRef.current; if (!container) return undefined;
    const canvasEl = container.querySelector('.maid-canvas-area .maid-canvas-wrap') || container.querySelector('.maid-canvas-wrap');
    if (!canvasEl) return undefined;

    setStatus('初始化渲染器…'); setError('');
    const app = new Application({
      resizeTo: canvasEl,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: dpi,
      roundPixels: true,
      powerPreference: 'high-performance',
    });
    appRef.current = app;
    try { if (app.view && app.view.parentNode !== canvasEl) canvasEl.appendChild(app.view); } catch { /* ignore */ }

    // Application 就绪后，首屏加载当前模型
    try {
      setStatus('加载模型…');
      void loadAndShowModel(getCurrentConfig().modelPath);
    } catch (e) {
      console.error('[Maid] 首屏加载模型失败', e);
      setError(e?.message || '模型加载失败');
    }

    const handleResize = () => {
      if (!app || !canvasEl || !app.renderer) return;
      try { app.renderer.resize(canvasEl.clientWidth, canvasEl.clientHeight); } catch { /* ignore */ }
      try { fitAndPlaceMemo(); } catch { /* ignore */ }
    };
    // 轻微跟随鼠标
    const onMove = (e) => {
      try {
        const rect = canvasEl.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
        const ny = ((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1;
        const maxX = 16; const maxY = 10;
        offsetRef.current = { x: nx * maxX, y: ny * maxY };
        const m = modelRef.current; if (m) { m.x = basePosRef.current.x + offsetRef.current.x; m.y = basePosRef.current.y + offsetRef.current.y; }
      } catch { /* ignore */ }
    };
    const onLeave = () => {
      offsetRef.current = { x: 0, y: 0 };
      const m = modelRef.current; if (m) { m.x = basePosRef.current.x; m.y = basePosRef.current.y; }
    };

    window.addEventListener('resize', handleResize);
    try { canvasEl.addEventListener('pointermove', onMove); } catch { /* ignore */ }
    try { canvasEl.addEventListener('pointerleave', onLeave); } catch { /* ignore */ }

    const preloadedAtMount = preloadedRef.current;

    return () => {
      window.removeEventListener('resize', handleResize);
      try { canvasEl.removeEventListener('pointermove', onMove); } catch { /* ignore */ }
      try { canvasEl.removeEventListener('pointerleave', onLeave); } catch { /* ignore */ }
      try { Ticker.shared.remove(enforcerFnRef.current); } catch { /* ignore */ }
      enforcerOnRef.current = false; compositeTargetRef.current = new Map();
      try {
        if (modelRef.current && app && app.stage) {
          try { app.stage.removeChild(modelRef.current); } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      try {
        preloadedAtMount.forEach((m) => {
          try {
            if (m && m.parent) m.parent.removeChild(m);
            m && m.destroy && m.destroy(true);
          } catch { /* ignore */ }
        });
        app.destroy(true, { children: true, texture: true, baseTexture: true });
      } catch { /* ignore */ }
      appRef.current = null;
    };
  }, [dpi, fitAndPlaceMemo]);

  // 面板尺寸、分割比例变动时，调整 renderer 并重新布局模型
  useEffect(() => {
    const app = appRef.current; const container = containerRef.current; if (!app || !container || !app.renderer) return;
    const visibleWrap = container.querySelector('.maid-canvas-area .maid-canvas-wrap') || container.querySelector('.maid-canvas-wrap');
    const canvasEl = visibleWrap; if (!canvasEl) return;
    try { app.renderer.resize(canvasEl.clientWidth, canvasEl.clientHeight); } catch { /* ignore */ }
    try { fitAndPlaceMemo(); } catch { /* ignore */ }
  }, [panelWidth, collapsed, userScale, dpi, splitRatio, innerHeight, fitAndPlaceMemo]);


  const loadAndShowModel = useCallback(async (path) => {
    const cfgPath = path || getCurrentConfig().modelPath;
    const app = appRef.current; if (!app || app.destroyed || !app.stage) return;
    try {
      // 确保 Cubism Core 可用，否则 from() 会无声失败
      await ensureCubismCoreReady();
      setStatus('加载模型资源…'); setError('');
      console.debug('[Maid] Loading model:', cfgPath);
      if (modelRef.current && app && app.stage) {
        try { modelRef.current.autoUpdate = false; } catch { /* ignore */ }
        try { app.stage.removeChild(modelRef.current); } catch { /* ignore */ }
        try {
          const oldPath = modelUrlRef.current;
          if (oldPath && oldPath !== cfgPath) {
            try { modelRef.current.destroy(true); } catch { /* ignore */ }
            try { preloadedRef.current.delete(oldPath); } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      }
      try { app.stage.removeChildren(); } catch { /* ignore */ }
      let model = preloadedRef.current.get(cfgPath);
      if (!model) {
        // 禁用初始化阶段的 autoUpdate，待注册 ticker 后再开启，
        // 规避某些环境下 _ticker 未就绪导致的 "Cannot read properties of undefined (reading 'add')"。
        model = await Live2DModel.from(cfgPath, { autoInteract: false, autoUpdate: false });
        model.interactive = true;
        if (model.anchor && typeof model.anchor.set === 'function') model.anchor.set(0.5, 0.5);
        try {
          // 双保险：确保实例级 ticker 存在
          if (!model._ticker && Ticker?.shared) model._ticker = Ticker.shared;
          // 开启自动更新
          model.autoUpdate = true;
        } catch { /* ignore */ }
        preloadedRef.current.set(cfgPath, model);
      }
      modelRef.current = model; modelUrlRef.current = cfgPath;
      model.visible = true;
      if (app && app.stage) {
        if (model.parent !== app.stage) app.stage.addChild(model);
      } else return;
      try {
        if (!model._ticker && Ticker?.shared) model._ticker = Ticker.shared;
        model.autoUpdate = true;
      } catch { /* ignore */ }
      try { const found = Object.entries(modelConfigs).find(([, c]) => c.modelPath === cfgPath); if (found) setCurrentModelKey(found[0]); } catch { /* ignore */ }
      fitAndPlaceMemo();
      try { Ticker.shared.remove(enforcerFnRef.current); } catch { /* ignore */ }
      enforcerOnRef.current = false; compositeTargetRef.current = new Map();
      try { expJsonCacheRef.current = new Map(); } catch { /* ignore */ }
      await startIdle(modelRef.current);
      setStatus(''); setError('');
      try {
        const { emotionList } = getCategorizedExpressions();
        setSelectedExpression(emotionList[0]?.name || '');
        setSelectedClothes([]);
        setSelectedAction('');
        setSelectedScene('');
      } catch { /* ignore */ }
    } catch (e) { console.error('[Maid] 加载模型失败:', e); setError(e?.message || '加载模型失败'); setStatus(''); }
  }, [getCurrentConfig, fitAndPlaceMemo, getCategorizedExpressions, startIdle]);

  const resolveExpressionUrl = useCallback((file) => {
    const f = String(file || '').replace(/\\/g, '/');
    if (/^https?:\/\//i.test(f) || f.startsWith('/')) return f;
    const fallbackPath = (modelConfigs[currentModelKey] || modelConfigs[DEFAULT_CONFIG_KEY]).modelPath;
    const modelUrl = modelUrlRef.current || fallbackPath;
    const i = modelUrl.lastIndexOf('/'); const base = i >= 0 ? modelUrl.slice(0, i + 1) : '/';
    return base + f;
  }, [currentModelKey, modelUrlRef]);

  const getExpressionJson = useCallback(async (file) => {
    const url = resolveExpressionUrl(file);
    const cache = expJsonCacheRef.current; if (cache.has(url)) return cache.get(url);
    const res = await fetch(url, { cache: 'no-cache' }); if (!res.ok) throw new Error(`加载表达式失败: ${url}`);
    const json = await res.json(); cache.set(url, json); return json;
  }, [resolveExpressionUrl, expJsonCacheRef]);

  const applyCompositeFromSelections = useCallback(async () => {
    const model = modelRef.current; if (!model) return;
    const { clothesList, actionList, sceneList } = getCategorizedExpressions();
    const need = new Map(); const pushNeed = (list) => list.forEach((it) => it && need.set(it.name, { file: it.file, json: null }));
    pushNeed(clothesList); pushNeed(actionList); pushNeed(sceneList);
    await Promise.all([...need.entries()].map(async ([, v]) => { try { v.json = await getExpressionJson(v.file); } catch { v.json = null; } }));
    const getParamIds = (names) => { const s = new Set(); names.forEach((n) => { const j = need.get(n)?.json; (j?.Parameters || j?.parameters || []).forEach((p) => { const id = p?.Id || p?.id; if (id) s.add(id); }); }); return s; };
    const clothesNames = clothesList.map(x => x.name); const actionNames = actionList.map(x => x.name); const sceneNames = sceneList.map(x => x.name);
    const clothesParams = getParamIds(clothesNames); const actionParams = getParamIds(actionNames); const sceneParams = getParamIds(sceneNames);
    const target = new Map(); const setParamsFrom = () => (n) => { const j = need.get(n)?.json; if (!j) return; for (const p of (j.Parameters || j.parameters || [])) { const id = p?.Id || p?.id; if (!id) continue; const v = Number(p?.Value ?? p?.value ?? 0); target.set(id, v); } };
    selectedClothes.forEach(setParamsFrom()); clothesParams.forEach((id) => { if (!target.has(id)) target.set(id, 0); });
    if (selectedAction) setParamsFrom()(selectedAction); actionParams.forEach((id) => { if (!selectedAction || !target.has(id)) target.set(id, 0); });
    if (selectedScene) setParamsFrom()(selectedScene); sceneParams.forEach((id) => { if (!selectedScene || !target.has(id)) target.set(id, 0); });
    compositeTargetRef.current = target;
    if (!target.size) { try { Ticker.shared.remove(enforcerFnRef.current); } catch (err) { void err; } enforcerOnRef.current = false; return; }
    const composite = { Type: 'Live2D Expression', FadeInTime: 0.12, FadeOutTime: 0.1, Parameters: Array.from(target.entries()).map(([Id, Value]) => ({ Id, Value, Blend: 'Overwrite' })), };
    try { await model.expression(composite); } catch (err) { void err; }
    if (!enforcerOnRef.current) {
      const fn = () => { try { const m = modelRef.current; if (!m) return; const core = m?.internalModel?.coreModel; if (!core) return; for (const [id, v] of compositeTargetRef.current.entries()) { try { if (core.setParameterValueById) core.setParameterValueById(id, v); else if (core.setParameterById) core.setParameterById(id, v); } catch (err) { void err; } } } catch (err) { void err; } };
      enforcerFnRef.current = fn; try { Ticker.shared.add(fn); } catch (err) { void err; }
      enforcerOnRef.current = true;
    }
  }, [getCategorizedExpressions, getExpressionJson, selectedClothes, selectedAction, selectedScene, compositeTargetRef, enforcerFnRef, enforcerOnRef, modelRef]);

  useEffect(() => { void applyCompositeFromSelections(); }, [applyCompositeFromSelections, selectedClothes, selectedAction, selectedScene]);

  useEffect(() => {
    const app = appRef.current; const container = containerRef.current; if (!app || !container || !app.renderer) return;
    const r = Math.max(1, Math.min(3, Number(dpi) || 1));
    try {
      if (app.renderer.resolution !== r) {
        app.renderer.resolution = r;
        app.renderer.resize(container.clientWidth, container.clientHeight);
      }
    } catch { /* ignore */ }
  }, [dpi]);

  useEffect(() => { fitAndPlaceMemo(); }, [fitAndPlaceMemo]);

  useEffect(() => {
    const el = containerRef.current; if (!el) return; const bar = el.querySelector('.maid-controlbar'); if (!bar) return; const btns = Array.from(bar.querySelectorAll('button.maid-btn'));
    btns.forEach((b, i) => { try { b.style.setProperty('--i', String(i)); } catch (err) { void err; } }); try { bar.style.setProperty('--btnCount', String(btns.length)); } catch (err) { void err; }
    try { setControlbarH(bar.offsetHeight || 0); } catch (err) { void err; }
  }, []);

  // 在尺寸、分割比例变化时，更新控制栏高度（确保画布高度 = 底部区高度 - 控制栏高度）
  useEffect(() => {
    const el = containerRef.current; if (!el) return; const bar = el.querySelector('.maid-controlbar');
    try { setControlbarH((bar && bar.offsetHeight) || 0); } catch (err) { void err; }
  }, [innerHeight, splitRatio, panelWidth]);

  const toggleCollapsed = () => { setCollapsed((v) => !v); };
  const toggleSettings = () => { setCollapsed(false); setSettingsOpen((v) => !v); };

  // 侧栏宽度拖动
  const resizingRef = useRef(false);
  const resizerStartXRef = useRef(0);
  const resizerStartWRef = useRef(0);

  useEffect(() => {
    const onPointerMove = (e) => {
      if (!resizingRef.current) return;
      try {
        const dx = resizerStartXRef.current - e.clientX;
        const minW = 220; const maxW = Math.max(minW, window.innerWidth - 80);
        const next = Math.max(minW, Math.min(maxW, resizerStartWRef.current + dx));
        setPanelWidth(Math.round(next));
      } catch { /* ignore */ }
    };
    const onPointerUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      try { document.body.style.cursor = ''; } catch { /* ignore */ }
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  const onResizerPointerDown = (e) => {
    try {
      if (typeof e.target.setPointerCapture === 'function' && e.pointerId != null) e.target.setPointerCapture(e.pointerId);
    } catch { /* ignore */ }
    resizingRef.current = true;
    resizerStartXRef.current = e.clientX;
    resizerStartWRef.current = (containerRef.current && containerRef.current.clientWidth) || panelWidth;
    try { document.body.style.cursor = 'ew-resize'; } catch { /* ignore */ }
  };

  useEffect(() => {
    try { localStorage.setItem(WIDTH_KEY, String(panelWidth)); } catch { /* ignore */ }
  }, [panelWidth]);

  // 分割条拖拽
  const draggingSplitRef = useRef(false);

  useEffect(() => {
    try { localStorage.setItem(SPLIT_KEY, String(splitRatio)); } catch { /* ignore */ }
  }, [splitRatio]);

  useEffect(() => {
    const onMove = (e) => {
      if (!draggingSplitRef.current) return;
      const el = containerRef.current; if (!el) return;
      const header = el.querySelector('.maid-header');
      const boxTop = (el.getBoundingClientRect().top || 0) + (header?.offsetHeight || 0);
      const total = innerHeight || (el.clientHeight - (header?.offsetHeight || 0));
      const y = e.clientY - boxTop;
      const lowerBound = Math.max(RATIO_MIN, total > 0 ? MIN_TOP_PX / total : RATIO_MIN);
      const upperBound = Math.min(RATIO_MAX, total > 0 ? 1 - (MIN_BOTTOM_PX / total) : RATIO_MAX);
      const ratio = Math.min(upperBound, Math.max(lowerBound, y / Math.max(1, total)));
      setSplitRatio(ratio);
    };
    const onUp = () => {
      if (!draggingSplitRef.current) return;
      draggingSplitRef.current = false;
      try { document.body.style.cursor = ''; } catch { /* ignore */ }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [innerHeight]);

  const onSplitPointerDown = (e) => {
    draggingSplitRef.current = true;
    try {
      if (typeof e?.target?.setPointerCapture === 'function' && e.pointerId != null) e.target.setPointerCapture(e.pointerId);
    } catch { /* ignore */ }
    try { document.body.style.cursor = 'ns-resize'; } catch { /* ignore */ }
  };

  const onSplitDoubleClick = () => {
    const el = containerRef.current; if (!el) { setSplitRatio(0.5); return; }
    const header = el.querySelector('.maid-header');
    const total = innerHeight || (el.clientHeight - (header?.offsetHeight || 0));
    const lowerBound = Math.max(RATIO_MIN, total > 0 ? MIN_TOP_PX / total : RATIO_MIN);
    const upperBound = Math.min(RATIO_MAX, total > 0 ? 1 - (MIN_BOTTOM_PX / total) : RATIO_MAX);
    const mid = 0.5;
    setSplitRatio(Math.min(upperBound, Math.max(lowerBound, mid)));
  };

  const onSplitKeyDown = (e) => {
    const key = e.key;
    const step = (key === 'PageUp' || key === 'PageDown') ? 0.1 : 0.02;
    let next = splitRatio;
    if (key === 'ArrowUp' || key === 'PageUp' || key === 'Home') next = key === 'Home' ? RATIO_MIN : splitRatio + step;
    if (key === 'ArrowDown' || key === 'PageDown' || key === 'End') next = key === 'End' ? RATIO_MAX : splitRatio - step;
    if (next === splitRatio) return;
    const el = containerRef.current; if (!el) { setSplitRatio(Math.min(RATIO_MAX, Math.max(RATIO_MIN, next))); return; }
    const header = el.querySelector('.maid-header');
    const total = innerHeight || (el.clientHeight - (header?.offsetHeight || 0));
    const lowerBound = Math.max(RATIO_MIN, total > 0 ? MIN_TOP_PX / total : RATIO_MIN);
    const upperBound = Math.min(RATIO_MAX, total > 0 ? 1 - (MIN_BOTTOM_PX / total) : RATIO_MAX);
    setSplitRatio(Math.min(upperBound, Math.max(lowerBound, next)));
    try { e.preventDefault(); } catch { /* ignore */ }
  };

  useEffect(() => {
    const onResize = () => {
      try {
        // 计算面板内可用高度（去除顶部栏高度）
        const el = containerRef.current; if (el) {
          const header = el.querySelector('.maid-header');
          const h = el.clientHeight - (header?.offsetHeight || 0);
          setInnerHeight(h > 0 ? h : 0);
        }
      } catch { /* noop */ }
    };
    window.addEventListener('resize', onResize);
    // 初次计算
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);


    // 计算上下区以及画布区高度（扣除控制栏高度）
    const topHeightPx = innerHeight ? Math.max(0, Math.round(innerHeight * splitRatio)) : 0;
    const bottomHeightPx = innerHeight ? Math.max(0, innerHeight - topHeightPx - 6) : 0;
    const canvasAreaHeightPx = Math.max(0, bottomHeightPx - (Number(controlbarH) || 0));

    return (
    <div ref={containerRef} className={`maid-widget maid-float${collapsed ? ' maid-collapsed' : ''}`} style={{ width: panelWidth ? `${panelWidth}px` : undefined }}>
      <div className="maid-resizer" role="separator" aria-orientation="vertical" onPointerDown={onResizerPointerDown} />

      {/* 顶部栏：动作（设置/收起） */}
      <Header settingsOpen={settingsOpen} onToggleSettings={toggleSettings} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />

      {/* 主体：上部聊天，下部看板娘，可拖拽分割 */}
      <div className="maid-top" style={{ height: innerHeight ? topHeightPx + 'px' : undefined }}>
        <div className="maid-ai-chat-wrap">
          <MaidAiChat visible={!collapsed} />
        </div>
      </div>
      <Splitter
        onPointerDown={onSplitPointerDown}
        onDoubleClick={onSplitDoubleClick}
        onKeyDown={onSplitKeyDown}
        value={splitRatio}
        min={RATIO_MIN}
        max={RATIO_MAX}
      />
      <div className="maid-bottom" style={{ height: innerHeight ? bottomHeightPx + 'px' : undefined }}>
        <CanvasArea heightPx={canvasAreaHeightPx} />
        <ControlBar getCategorizedExpressions={getCategorizedExpressions} openPanel={openPanel} setOpenPanel={setOpenPanel} />
        {status && <div className="maid-status" role="status">{status}</div>}
        {error && !status && <div className="maid-error" role="alert">{error}</div>}
      </div>

      {settingsOpen && !collapsed && (
        <SettingsPanel
          dpi={dpi}
          setDpi={setDpi}
          currentModelKey={currentModelKey}
          setCurrentModelKey={(key) => { setOpenPanel(''); setCurrentModelKey(key); }}
          modelConfigs={modelConfigs}
          loadAndShowModel={loadAndShowModel}
        />
      )}
      <EmotionPanel
        collapsed={collapsed}
        openPanel={openPanel}
        getCategorizedExpressions={getCategorizedExpressions}
        selectedExpression={selectedExpression}
        setSelectedExpression={(v) => { setSelectedExpression(v); setOpenPanel(''); }}
        selectedClothes={selectedClothes}
        setSelectedClothes={setSelectedClothes}
        selectedAction={selectedAction}
        setSelectedAction={(v) => { setSelectedAction(v); setOpenPanel(''); }}
        selectedScene={selectedScene}
        setSelectedScene={(v) => { setSelectedScene(v); setOpenPanel(''); }}
        modelRef={modelRef}
        getExpressionJson={getExpressionJson}
      />
      {/* 收起时仍显示的固定展开控件 */}
      {collapsed && <ExpandHandle onClick={() => setCollapsed(false)} />}
    </div>
  );
}
