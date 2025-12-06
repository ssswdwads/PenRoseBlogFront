import React from 'react';
import { createPortal } from 'react-dom';

export default function ExpandHandle({ onClick }) {
  return createPortal(
    <button className="maid-expand-handle" title="展开助手" aria-label="展开助手" onClick={onClick}>
      <img src="/icons/maid/aiservant.svg" alt="展开助手" />
    </button>,
    document.body
  );
}
