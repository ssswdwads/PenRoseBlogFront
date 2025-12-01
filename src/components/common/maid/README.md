# AI Maid 可复用助手组件

本组件将 AI 聊天与 Live2D 看板娘整合为一体，提供可复用的侧边助手面板。包含：
- React 上下文 `AiAssistantProvider`（暴露 `sendMessage` 与可选 `sendMessageStream`）
- 侧边助手 UI 组件 `Maid`
- 样式位于 `front/src/styles/common/aimaid/Maid.css`

## 快速使用

1. 在应用根附近包裹 Provider：

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AiAssistantProvider } from '../contexts/AiAssistantContext.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <AiAssistantProvider>
    <App />
  </AiAssistantProvider>
);
```

2. 在任意页面引入助手：

```jsx
import Maid from '../components/common/maid/Maid.jsx';

export default function Page() {
  return (
    <>
      <Maid />
    </>
  );
}
```

3. 后端接口
- 普通聊天：`POST /api/ai/chat { message }`
- 流式（SSE）：`GET /api/ai/chat/stream?message=...`（前端自动优先使用，失败时回退到普通接口）

> SSE 为非上游直连流式：后端会将完整回复拆分为小块逐步推送，优化用户体验。

## 配置模型与表情
- 参见 `front/src/components/common/maid/constants.js`
- 可在其中增减 `modelConfigs` 模型与表情/装扮/动作/场景定义

## 注意事项
- 如需自定义主题，可在 `.maid-widget` 上覆盖 CSS 变量或追加样式。
- 若未部署 `/live2dsrc/live2dcubismcore.min.js`，组件会在运行时自动注入脚本。
- 生产环境请在后端配置 `spring.ai.openai.*` 对接兼容的 OpenAI 接口（或设置环境变量）。
