import React from 'react';

export default function SettingsPanel({ dpi, setDpi, currentModelKey, setCurrentModelKey, modelConfigs, loadAndShowModel }) {
  return (
    <div id="maid-settings-panel" className="maid-settings-panel" role="dialog" aria-label="看板娘设置">
      <div className="maid-field">
        <label className="maid-controls-label" htmlFor="maidDpi">清晰度</label>
        <select id="maidDpi" className="maid-select" value={String(dpi)} onChange={(e) => setDpi(parseFloat(e.target.value))} title="调整渲染分辨率，数值越大越耗性能">
          <option value="1">1x</option>
          <option value="2">2x</option>
          <option value="3">3x</option>
        </select>
      </div>
      <div className="maid-field">
        <label className="maid-controls-label" htmlFor="maidModel">模型</label>
        <select id="maidModel" className="maid-select" title="切换模型" value={currentModelKey} onChange={(e) => { const key = e.target.value; try { setCurrentModelKey(key); } catch (err) { void err; } const cfg = modelConfigs[key]; if (cfg && cfg.modelPath) { void loadAndShowModel(cfg.modelPath); } }}>
          {Object.entries(modelConfigs).map(([key, cfg]) => (<option key={key} value={key}>{cfg.label || key}</option>))}
        </select>
      </div>
    </div>
  );
}
