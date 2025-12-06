import React from 'react';

export default function SettingsPanel({ dpi, setDpi }) {
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
      {/* 模型选择控件已移除，前端不再切换模型 */}
    </div>
  );
}
