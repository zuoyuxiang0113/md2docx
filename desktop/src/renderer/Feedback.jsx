import React, { useEffect } from "react";

const glyphs = { check: "✓", warning: "!", remove: "×" };
function Glyph({ name }) { return <span className={`icon-glyph icon-${name}`} aria-hidden="true">{glyphs[name]}</span>; }

function ToastItem({ toast, onDismiss }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);
  return <div className={`global-toast toast-${toast.type}`} role={toast.type === "error" ? "alert" : "status"} style={{ "--toast-duration": `${toast.duration}ms` }}>
    <span className="toast-icon"><Glyph name={toast.type === "success" ? "check" : "warning"} /></span>
    <span className="toast-message">{toast.message}</span>
    <button className="toast-close" type="button" aria-label="关闭" onClick={() => onDismiss(toast.id)}><Glyph name="remove" /></button>
    <span className="toast-progress" aria-hidden="true" />
  </div>;
}

export function ToastViewport({ toasts, onDismiss }) {
  return <div className="toast-viewport" aria-live="polite" aria-atomic="false">{toasts.map((toast) => <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />)}</div>;
}
