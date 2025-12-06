import { useEffect, useRef, useState } from 'react';

export default function usePanelWidth(initialKey = 'maid.panelWidth') {
  const WIDTH_KEY = initialKey;
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
  const resizingRef = useRef(false);
  const resizerStartXRef = useRef(0);
  const resizerStartWRef = useRef(0);

  useEffect(() => {
    try { localStorage.setItem(WIDTH_KEY, String(panelWidth)); } catch { /* ignore */ }
  }, [panelWidth]);

  const onResizerPointerDown = (e, containerEl) => {
    try {
      if (typeof e.target.setPointerCapture === 'function' && e.pointerId != null) e.target.setPointerCapture(e.pointerId);
    } catch { /* ignore */ }
    resizingRef.current = true;
    resizerStartXRef.current = e.clientX;
    resizerStartWRef.current = (containerEl && containerEl.clientWidth) || panelWidth;
    try { document.body.style.cursor = 'ew-resize'; } catch { /* ignore */ }
  };

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

  return { panelWidth, setPanelWidth, onResizerPointerDown };
}
