import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github.css';
import useAiAssistant from '../../../contexts/useAiAssistant';

export default function MaidAiChat({ visible }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef(null);
  const ai = useAiAssistant();

  useEffect(() => {
    if (!visible) return;
    setMessages((m) => { if (m.length === 0) return [{ role: 'assistant', text: '你好，我是你的看板娘 AI 助手，有什么可以帮忙的吗？' }]; return m; });
  }, [visible]);

  useEffect(() => {
    const el = listRef.current; if (!el) return; try { if (typeof el.scrollTop === 'number' && typeof el.scrollHeight === 'number') { el.scrollTop = el.scrollHeight; } else if (typeof el.scrollTo === 'function') { el.scrollTo({ top: el.scrollHeight, behavior: 'auto' }); } } catch (err) { console.warn('MaidAiChat: failed to scroll messages', err); }
  }, [messages]);

  const send = async () => {
    const t = String(text || '').trim(); if (!t) return; setSending(true); setError('');
    setMessages((m) => [...m, { role: 'user', text: t }]); setText('');
    try {
      if (!ai || (!ai.sendMessage && !ai.sendMessageStream)) {
        // fallback to direct fetch if provider not available
        const res = await fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: t }) });
        if (!res.ok) { const txt = await res.text(); throw new Error(`请求失败 ${res.status}: ${txt}`); }
        const data = await res.json(); const raw = data?.reply ?? data; setMessages((m) => [...m, { role: 'assistant', text: String(raw ?? '') }]);
        return;
      }

      // Prefer streaming if available
      if (ai.sendMessageStream) {
        let idx;
        setMessages((m) => { idx = m.length; return [...m, { role: 'assistant', text: '' }]; });
        const appendChunk = (chunk) => {
          const c = String(chunk || '');
          setMessages((m) => {
            const next = [...m];
            if (idx == null || idx >= next.length) return next;
            next[idx] = { ...next[idx], text: (next[idx].text || '') + c };
            return next;
          });
        };
        try {
          const full = await ai.sendMessageStream(t, { onChunk: appendChunk });
          // ensure final text present (in case onChunk missed anything)
          setMessages((m) => {
            const next = [...m];
            if (idx != null && idx < next.length) next[idx] = { ...next[idx], text: String(full || next[idx].text || '') };
            return next;
          });
          return;
        } catch {
          // streaming path failed, fallback to non-streaming
          const raw = await ai.sendMessage(t);
          const replyText = normalizeReply(raw);
          setMessages((m) => [...m, { role: 'assistant', text: replyText }]);
          return;
        }
      }

      // Non-streaming path
      const raw = await ai.sendMessage(t);
      const replyText = normalizeReply(raw);
      setMessages((m) => [...m, { role: 'assistant', text: replyText }]);
    } catch (e) {
      console.error(e); setError(e?.message || '发送失败'); setMessages((m) => [...m, { role: 'assistant', text: '抱歉，出错了：' + (e?.message || '') }]);
    } finally { setSending(false); }
  };

  function normalizeReply(raw) {
    if (raw == null) return '';
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'object') {
      try {
        const choices = raw.choices || raw.result || raw.outputs;
        if (Array.isArray(choices) && choices.length > 0) {
          const first = choices[0];
          if (first?.message?.content) return first.message.content;
          if (first?.text) return first.text;
          if (first?.content) return first.content;
          return JSON.stringify(raw);
        } else if (raw?.message && typeof raw.message === 'string') return raw.message;
        else if (raw?.content && typeof raw.content === 'string') return raw.content;
        return JSON.stringify(raw);
      } catch { return String(raw); }
    }
    return String(raw);
  }

  const onKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } };

  if (!visible) return null;

  return (
    <div className="maid-ai-panel" role="dialog" aria-label="看板娘 AI 助手">
      <div className="maid-ai-header">
        <strong>看板娘 AI 助手</strong>
        {sending && <span className="maid-ai-sending">发送中…</span>}
      </div>
      <div className="maid-ai-messages" ref={listRef}>
        {messages.map((m, i) => (
          <div key={i} className={`maid-ai-msg ${m.role === 'user' ? 'user' : 'assistant'}`}>
            <div className="maid-ai-msg-text"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{String(m.text || '')}</ReactMarkdown></div>
          </div>
        ))}
      </div>
      <div className="maid-ai-input-row">
        <textarea className="maid-ai-input" placeholder="向看板娘提问，按 Enter 发送（Shift+Enter 换行）" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} rows={2} />
        <button className="maid-iconbtn" onClick={() => void send()} disabled={sending || !text.trim()} title="发送">发送</button>
      </div>
      {error && <div className="maid-ai-error">{error}</div>}
    </div>
  );
}
