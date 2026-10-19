import React from "react";
import Icon from "./Icon.jsx";

export function ConfirmationDialog({ confirmation, closeLabel, onFinish }) {
  if (!confirmation) return null;
  return <div className="modal-backdrop confirmation-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onFinish("cancel"); }}>
    <section className={`confirmation-dialog tone-${confirmation.tone || "warning"}`} role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-message" onKeyDown={(event) => { if (event.key === "Escape") onFinish("cancel"); }}>
      <div className="confirmation-header">
        <span className="confirmation-icon"><Icon name="warning" /></span>
        <div><h2 id="confirmation-title">{confirmation.title}</h2><p id="confirmation-message">{confirmation.message}</p></div>
        <button className="icon-button" type="button" title={closeLabel} aria-label={closeLabel} onClick={() => onFinish("cancel")}><Icon name="remove" /></button>
      </div>
      <div className="confirmation-actions">{confirmation.actions.map((action) => <button autoFocus={action.primary} className={`button ${action.variant}`} type="button" key={action.value} onClick={() => onFinish(action.value)}>{action.label}</button>)}</div>
    </section>
  </div>;
}

export function ProfileDialog({ action, actionText, text, onChange, onComplete, onClose }) {
  if (!action) return null;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title">
      <div className="profile-dialog-header"><span className={`profile-dialog-icon ${action.mode === "delete" ? "is-danger" : ""}`}><Icon name={action.mode === "delete" ? "remove" : "config"} /></span><div><h2 id="profile-dialog-title">{actionText?.[0]}</h2><p>{actionText?.[1]}</p></div><button className="icon-button" type="button" title={text.close} aria-label={text.close} onClick={onClose}><Icon name="remove" /></button></div>
      {action.mode === "delete" ? <div className="profile-delete-target"><span>{text.selectedProfile}</span><strong>{action.targetId}.json</strong></div> : <label className="profile-id-field"><span>{text.profileIdLabel}</span><div><input autoFocus value={action.value} onChange={(event) => onChange(event.target.value.trim().toLowerCase())} onKeyDown={(event) => { if (event.key === "Enter" && !action.error) onComplete(); if (event.key === "Escape") onClose(); }} /><code>.json</code></div><small>{text.profileIdHint}</small></label>}
      {action.error && <div className="profile-dialog-error"><Icon name="warning" />{action.error}</div>}
      <div className="profile-dialog-actions">
        <button className="button subtle" type="button" onClick={onClose}>{text.cancel}</button>
        {action.mode === "importConflict" && <button className="button outline" type="button" onClick={() => onComplete("overwrite")}>{text.overwrite}</button>}
        <button className={`button ${action.mode === "delete" ? "danger" : "primary"}`} type="button" disabled={Boolean(action.error)} onClick={() => onComplete()}>{actionText?.[2]}</button>
      </div>
    </section>
  </div>;
}
