'use strict';














(function (global) {
  const POPUP_MARKUP = `
    <div class="th-popup-body"><div class="th-main-view" id="th-main-view"><div class="th-row th-top-row"><div class="th-controls">
      <button class="th-btn th-bo-reset-btn" id="th-btn-bo-reset" title="Lançar Abas Backoffice"><svg class="th-bo-reset-icon" width="17" height="17" viewBox="0 0 24 24" fill="none"><path stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M4 5v5h5M5 9a8 8 0 1 1-.8 6"/></svg><svg class="th-bo-launch-icon" width="19" height="19" viewBox="0 0 24 24" fill="none" style="display:none"><path d="M12 19V5M6 11l6-6 6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button class="th-btn th-history-btn" id="th-btn-history" title="Histórico" aria-label="Histórico"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2"/></svg></button>
      <span class="th-drag-handle" title="Arrastar"><svg width="14" height="17" viewBox="0 0 12 14" fill="currentColor" style="transform:rotate(90deg)"><circle cx="3" cy="2.5" r="1.4"/><circle cx="9" cy="2.5" r="1.4"/><circle cx="3" cy="7" r="1.4"/><circle cx="9" cy="7" r="1.4"/><circle cx="3" cy="11.5" r="1.4"/><circle cx="9" cy="11.5" r="1.4"/></svg></span>
      <button class="th-btn" id="th-btn-gear" title="Configurações" aria-label="Configurações"><svg width="15" height="15" viewBox="-1 -1 26 26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
      <button class="th-btn" id="th-btn-close" title="Desativar TicketHelper" aria-label="Desativar TicketHelper"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="m18 6-12 12M6 6l12 12"/></svg></button>
    </div><div class="th-copyable" id="th-id-row"><span class="th-val" id="th-id-val">-</span></div></div>
      <div class="th-row"><div class="th-copyable" id="th-name-row"><span class="th-val" id="th-name-val">-</span></div></div>
      <div class="th-row"><div class="th-copyable" id="th-email-row"><span class="th-val" id="th-email-val">-</span></div></div>
      <div class="th-row"><div class="th-copyable" id="th-doc-row"><span class="th-val" id="th-doc-val">-</span></div></div>
      <div class="th-row"><div class="th-copyable th-accounts-row" id="th-accounts-row"><span class="th-val" id="th-accounts-val">-</span></div></div>
    </div><div class="th-history-view" id="th-history-view" aria-hidden="true"></div></div>
  `;

  const POPUP_STYLES = `
    #ticket-helper-popup {
      position: fixed;
      box-sizing: content-box;
      width: 219.28px;
      background-color: rgba(17,24,39,0.6);
      opacity: 1;
      color: #f9fafb;
      border-radius: 10px;
      font-size: 13px;
      font-family: 'SF Mono','Consolas','Menlo',monospace;
      z-index: 2147483647;
      box-shadow: 0 8px 30px rgba(0,0,0,0.5);
      padding: 4px 6px 7px;
      display: flex;
      flex-direction: column;
      gap: 0;
      visibility: hidden;
      overflow: hidden;
      user-select: none;
    }
    .th-row { display:flex; align-items:center; width:100%; min-height:18px; }
    .th-main-view > .th-row { min-height:15px; }
    .th-main-view > .th-row:not(.th-top-row) {
      width:calc(100% - 1px); margin-left:0;
    }
    .th-top-row {
      justify-content:flex-start; gap:4px;
      height:15px; min-height:15px; padding:0; margin:0; overflow:visible;
      width:calc(100% - 1px); margin-right:0;
    }
    .th-copyable {
      display:flex; align-items:center; gap:3px; position:relative;
      flex:1; min-width:0; cursor:pointer;
      box-sizing:border-box; width:100%; padding:0; border-radius:4px;
      overflow:visible;
    }
    .th-copyable.is-non-copyable { cursor:default; pointer-events:none; }
    .th-copyable.is-non-copyable .th-val { text-decoration:none !important; }
    .th-copyable.is-copy-success::before {
      content:""; position:absolute; top:0; right:-4px;
      width:var(--th-copy-flash-width, 0px); height:100%;
      border-radius:4px; pointer-events:none;
      animation:th-copy-success 0.8s linear both;
    }
    @keyframes th-copy-success {
      0%, 50% { background-color:rgba(42,174,88,1); }
      100% { background-color:rgba(42,174,88,0); }
    }
    .th-copyable.is-bo-missing::before {
      content:""; position:absolute; top:0; right:-4px;
      width:var(--th-copy-flash-width, 0px); height:100%;
      border-radius:4px; pointer-events:none;
      animation:th-bo-missing-flash 0.8s linear both;
    }
    @keyframes th-bo-missing-flash {
      0%, 50% { background-color:rgba(210,57,57,1); }
      100% { background-color:rgba(210,57,57,0); }
    }
    .th-copyable.is-value-loading { position:relative; overflow:visible; }
    .th-copyable.is-value-loading .th-val { visibility:hidden; }
    .th-copyable.is-value-loading::after {
      content:""; position:absolute; right:1px; top:0;
      width:16px; height:16px; box-sizing:border-box;
      border:2.5px solid transparent; border-top-color:#fff;
      border-radius:50%;
      animation:th-value-loading-spin 0.8s linear infinite;
      pointer-events:none;
    }
    @keyframes th-value-loading-spin {
      to { transform:rotate(1turn); }
    }
    .th-main-view .th-copyable {
      align-items:flex-start;
      padding-bottom:4px;
      margin-bottom:-4px;
      transform:translateY(1px);
    }
    #th-id-row {
      padding-bottom:3px;
      margin-bottom:-3px;
      transform:translateY(2px);
    }
    .th-copyable:hover { background:transparent; }
    .th-copyable:hover .th-val { text-decoration:underline; text-underline-offset:2px; }
    .th-val { position:relative; color:#f9fafb; font-family:monospace; font-size:14px; font-weight:400; white-space:nowrap; overflow:visible; text-align:right; flex:1 1 auto; min-width:0; height:15px; line-height:18px; }
    .th-val.is-muted-status { color:#f9fafb; }
    .th-controls {
      position: relative;
      transform: translateY(2px);
      display:flex; align-items:center; justify-content:flex-start; gap:4px; width:116px; flex:0 0 116px; margin-left:0;
      height:15px; min-height:15px;
    }
    .th-drag-handle {
      cursor:move; color:#c5cbd4;
      display:flex; align-items:center; justify-content:center;
      box-sizing:border-box; width:20px; height:20px; flex:0 0 20px;
      padding:0; margin:0;
      align-self: center;
    }
    .th-drag-handle:hover,
    .th-drag-handle:active { color:#fff; }
    .th-btn {
      cursor:pointer; background:none; border:none; color:#c5cbd4;
      box-sizing:border-box; min-width:0; padding:0; line-height:0;
      display:flex; align-items:center; justify-content:center;
      transition:color 0.12s;
      box-sizing:border-box; width:20px; height:20px; flex:0 0 20px;
      align-self: center;
    }
    .th-btn svg {
      flex-shrink: 0;
    }
    #th-btn-gear { margin:0; }
    .th-bo-reset-btn { width:20px; flex:0 0 20px; position:relative; }
    .th-bo-reset-btn.is-bo-missing::before {
      content:""; position:absolute; inset:0; border-radius:4px;
      pointer-events:none; animation:th-bo-missing-flash 0.8s linear both;
    }
    .th-bo-reset-btn.is-bo-missing svg { position:relative; }
    .th-bo-reset-btn.is-launch-mode .th-bo-reset-icon {
      display: none !important;
    }
    .th-bo-reset-icon {
      transform: translateY(-1px);
    }
    .th-bo-reset-btn.is-launch-mode .th-bo-launch-icon {
      display: block !important;
    }
    .th-bo-launch-icon {
      transform: translateY(-0.5px);
    }
    .th-history-btn {
      width: 20px;
      height: 20px;
      flex: 0 0 20px;
    }
    .th-history-btn svg {
      transform: translateY(-0.5px);
    }
    #ticket-helper-popup .th-btn:hover,
    #ticket-helper-popup .th-btn:active {
      color:#fff;
    }
    #ticket-helper-popup .th-history-btn.is-active {
      color:#fff;
    }
    .th-popup-body {
      position: relative;
    }
    .th-main-view {
      display: flex;
      flex-direction: column;
      gap: 6px;
      width: 100%;
    }
    #ticket-helper-popup.is-history-open .th-main-view > .th-row:not(.th-top-row) {
      visibility: hidden;
    }
    .th-history-view {
      display: none;
      position: absolute;
      inset: 21px 0 0;
      box-sizing: border-box;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding-top: 0;
      scrollbar-width: none;
    }
    .th-history-view::-webkit-scrollbar {
      width: 0;
      height: 0;
    }
    #ticket-helper-popup.is-history-open .th-history-view {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .th-history-row {
      display: flex;
      position: relative;
      align-items: center;
      gap: 0;
      flex: 0 0 15px;
      min-height: 15px;
      width: calc(100% - 1px);
      box-sizing: border-box;
      padding: 0;
      border: 0;
      background: transparent;
      color: #f9fafb;
      font-family: monospace;
      font-size: 14px;
      font-weight: 400;
      line-height: 18px;
      text-align: left;
      cursor: default;
      border-radius: 4px;
    }
    .th-history-row > * { position:relative; }
    .th-history-id:hover,
    .th-history-id:focus-visible,
    .th-history-email:hover,
    .th-history-email:focus-visible {
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .th-history-id,
    .th-history-email {
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      line-height: inherit;
      text-align: left;
      cursor: pointer;
    }
    .th-history-id {
      flex: 0 0 auto;
      margin-right: 1ch;
      white-space: nowrap;
    }
    .th-history-id.is-copy-success::before {
      content: "";
      position: absolute;
      inset: 0 -4px;
      border-radius: 4px;
      pointer-events: none;
      animation: th-copy-success 0.8s linear both;
    }
    .th-history-email {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .th-history-open {
      display: none;
      align-items: center;
      justify-content: center;
      flex: 0 0 16px;
      width: 16px;
      height: 16px;
      margin-left: 2px;
      padding: 0;
      border: 0;
      background: transparent;
      color: #c5cbd4;
      cursor: pointer;
      line-height: 0;
    }
    .th-history-row:hover .th-history-open,
    .th-history-row:focus-within .th-history-open { display: flex; }
    .th-history-open:hover,
    .th-history-open:active,
    .th-history-open:focus-visible,
    .th-history-email:hover + .th-history-open,
    .th-history-email:focus-visible + .th-history-open { color: #fff; }
    .th-history-open svg { flex-shrink: 0; }
    .th-history-empty {
      display: flex;
      align-items: center;
      flex: 0 0 15px;
      min-height: 15px;
      color: #f9fafb;
      font-family: monospace;
      font-size: 14px;
      font-weight: 400;
      line-height: 18px;
    }

  `;

  function getMarkup() {
    return POPUP_MARKUP;
  }

  function getStyles() {
    return POPUP_STYLES;
  }

  function injectStyles(doc = document, styleId = 'th-styles') {
    if (!doc || !doc.head) return false;
    const existing = doc.getElementById(styleId);
    if (existing) existing.remove();
    const styleEl = doc.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = POPUP_STYLES;
    doc.head.appendChild(styleEl);
    return true;
  }

  global.TicketHelperPopupUI = {
    getMarkup,
    getStyles,
    injectStyles
  };
})(typeof window !== 'undefined' ? window : globalThis);
