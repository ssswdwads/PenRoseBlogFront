import React, { useCallback, useMemo, useState } from 'react';
import AiAssistantContext from './aiContextCore';

export function AiAssistantProvider({ children }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const sendMessage = useCallback(async (message, { model } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(model ? { message, model } : { message }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`请求失败 ${res.status}: ${txt}`);
      }
      const data = await res.json();
      return data?.reply ?? data;
    } catch (e) {
      setError(e?.message || String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const sendMessageStream = useCallback(async (message, { onChunk, firstChunkTimeoutMs = 20000, model } = {}) => {
    // Use EventSource (GET) to receive server-sent events from backend
    setLoading(true);
    setError(null);
    let controller;
    let firstTimer;
    try {
      const encoded = encodeURIComponent(String(message ?? ''));
      const url = `/api/ai/chat/stream?message=${encoded}${model ? `&model=${encodeURIComponent(model)}` : ''}`;
      if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
        // Fallback: no SSE support
        const full = await sendMessage(message, { model });
        if (onChunk) try { onChunk(full); } catch { /* ignore */ }
        return full;
      }
      const es = new EventSource(url, { withCredentials: false });
      controller = es;
      let acc = '';
      const done = new Promise((resolve, reject) => {
        es.onmessage = (ev) => {
          const data = ev?.data ?? '';
          acc += data;
          if (onChunk) try { onChunk(String(data)); } catch { /* ignore */ }
        };
        es.onerror = () => {
          // EventSource will try to reconnect; close and resolve with what we have
          try { es.close(); } catch { /* ignore */ }
          // If nothing received, treat as error to trigger fallback
          if (!acc) reject(new Error('SSE connection error'));
          else resolve(acc);
        };
        es.onopen = () => {
          // If the first chunk doesn't arrive within timeout, abort SSE and fallback
          if (firstChunkTimeoutMs > 0) {
            try { clearTimeout(firstTimer); } catch { /* ignore */ }
            firstTimer = setTimeout(() => {
              try { es.close(); } catch { /* ignore */ }
              if (!acc) reject(new Error('SSE first-chunk timeout'));
            }, firstChunkTimeoutMs);
          }
        };
      });
      const result = await done;
      try { es.close(); } catch { /* ignore */ }
      return result;
    } catch {
      // Fallback to non-streaming on errors
      try {
        const full = await sendMessage(message, { model });
        if (onChunk) try { onChunk(full); } catch { /* ignore */ }
        return full;
      } catch (inner) {
        setError(inner?.message || String(inner));
        throw inner;
      }
    } finally {
      setLoading(false);
      if (controller && controller.close) { try { controller.close(); } catch { /* ignore */ } }
      try { clearTimeout(firstTimer); } catch { /* ignore */ }
    }
  }, [sendMessage]);

  const value = useMemo(() => ({ sendMessage, sendMessageStream, loading, error }), [sendMessage, sendMessageStream, loading, error]);

  return (
    <AiAssistantContext.Provider value={value}>{children}</AiAssistantContext.Provider>
  );
}

export default AiAssistantProvider;
