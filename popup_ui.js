'use strict';














(function (global) {
  const POPUP_MARKUP = `
    <div class="th-row th-top-row">
      <div class="th-copyable" id="th-id-row" style="margin-right:0">
        <span class="th-label">ID:</span>
        <span class="th-val" id="th-id-val">-</span>
        <span class="th-check" id="th-check-id"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:block"><polyline points="20 6 9 17 4 12"/></svg></span>
      </div>
      <div class="th-controls">
        <button class="th-btn th-bo-btn" id="th-btn-botab1" title="Definir aba BO 1" style="margin-left:-4px;margin-top:-2px">
          <svg class="th-bo-tab-icon th-bo-tab-empty" width="23" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block">
            <rect x="4" y="5" width="16" height="14" rx="2"/>
            <path class="th-bo-inner-line" d="M4 9h16"/>
          </svg>
          <svg class="th-bo-tab-icon th-bo-tab-filled" width="23" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block" aria-hidden="true">
            <rect x="3.5" y="4.5" width="17" height="15" rx="2"/>
            <text class="th-bo-tab-number" x="12" y="12" dy=".35em">1</text>
          </svg>
        </button>
        <button class="th-btn th-bo-btn" id="th-btn-botab2" title="Definir aba BO 2" style="margin-left:-4px;margin-top:-2px">
          <svg class="th-bo-tab-icon th-bo-tab-empty" width="23" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block">
            <rect x="4" y="5" width="16" height="14" rx="2"/>
            <path class="th-bo-inner-line" d="M4 9h16"/>
          </svg>
          <svg class="th-bo-tab-icon th-bo-tab-filled" width="23" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block" aria-hidden="true">
            <rect x="3.5" y="4.5" width="17" height="15" rx="2"/>
            <text class="th-bo-tab-number" x="12" y="12" dy=".35em">2</text>
          </svg>
        </button>
        <div class="th-bo-hint" id="th-bo-hint" aria-hidden="true"><span id="th-bo-hint-text">sem BO1 e BO2 definido</span></div>
        <button class="th-btn" id="th-btn-bo-reset" title="Limpar abas BO" style="margin-left:-3px;margin-top:-3px">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true" style="display:block;margin-left:1px;margin-top:1px">
            <g transform="translate(24 0) scale(-1 1)">
              <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4" d="M4.252 4v5H9M5.07 8a8 8 0 1 1-.818 6"/>
            </g>
          </svg>
        </button>
        <span class="th-drag-handle" title="Arrastar">
          <svg width="12" height="15" viewBox="0 0 12 14" fill="currentColor" style="display:block">
            <circle cx="3" cy="2.5" r="1.4"/>
            <circle cx="9" cy="2.5" r="1.4"/>
            <circle cx="3" cy="7" r="1.4"/>
            <circle cx="9" cy="7" r="1.4"/>
            <circle cx="3" cy="11.5" r="1.4"/>
            <circle cx="9" cy="11.5" r="1.4"/>
          </svg>
        </span>
        <button class="th-btn" id="th-btn-gear" title="Configurações" style="margin-left:1px;margin-top:-2px">
          <svg width="15" height="15" viewBox="-1 -1 26 26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;overflow:visible">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <button class="th-btn" id="th-btn-close" title="Desativar" style="margin-top:-2px">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" style="display:block">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="th-row">
      <div class="th-copyable" id="th-name-row">
        <span class="th-label">Nome:</span>
        <span class="th-val" id="th-name-val">-</span>
        <span class="th-check" id="th-check-name"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:block"><polyline points="20 6 9 17 4 12"/></svg></span>
      </div>
    </div>
    <div class="th-row">
      <div class="th-copyable" id="th-email-row">
        <span class="th-label">Email:</span>
        <span class="th-val" id="th-email-val">-</span>
        <span class="th-check" id="th-check-email"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:block"><polyline points="20 6 9 17 4 12"/></svg></span>
      </div>
    </div>
    <div class="th-row">
      <div class="th-copyable" id="th-doc-row">
        <span class="th-label">Doc.:</span>
        <span class="th-val" id="th-doc-val">-</span>
        <span class="th-check" id="th-check-doc"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:block"><polyline points="20 6 9 17 4 12"/></svg></span>
      </div>
    </div>
    <div class="th-row">
      <div class="th-static">
        <span class="th-label">Contas:</span>
        <span class="th-val" id="th-accounts-val">-</span>
      </div>
    </div>
    <div class="th-actions-section" aria-hidden="true">
      <div class="th-actions-grid">
        <button class="th-action-slot th-action-btn is-unavailable" id="th-action-faturas" type="button">
          <span class="th-action-text">Faturas</span>
        </button>
        <button class="th-action-slot th-action-btn is-unavailable" id="th-action-nutror" type="button">
          <span class="th-action-text">Nutror</span>
        </button>
        <button class="th-action-slot th-action-btn is-unavailable" id="th-action-contratos" type="button">
          <span class="th-action-text">Contratos</span>
        </button>
        <div class="th-action-slot"></div>
      </div>
    </div>
  `;

  const POPUP_STYLES = `
    #ticket-helper-popup {
      position: fixed;
      width: 330px;
      background: #111827;
      color: #f9fafb;
      border-radius: 10px;
      font-size: 13px;
      font-family: 'SF Mono','Consolas','Menlo',monospace;
      z-index: 2147483647;
      box-shadow: 0 8px 30px rgba(0,0,0,0.5);
      padding: 6px 10px 8px;
      display: flex;
      flex-direction: column;
      gap: 1px;
      visibility: hidden;
      user-select: none;
    }
    .th-row { display:flex; align-items:center; min-height:22px; }
    .th-top-row {
      justify-content:space-between; gap:6px;
      padding-bottom:4px; margin-bottom:2px;
      border-bottom:1px solid rgba(255,255,255,0.07);
    }
    .th-copyable {
      display:flex; align-items:center; gap:3px;
      flex:1; min-width:0; cursor:pointer;
      padding:2px 3px; border-radius:4px;
      transition:background 0.12s; overflow:hidden;
    }
    .th-copyable:hover { background:rgba(255,255,255,0.06); }
    .th-copyable:hover .th-val { text-decoration:underline; text-underline-offset:2px; }
    .th-static {
      display:flex; align-items:center; gap:3px;
      flex:1; min-width:0; padding:2px 3px; overflow:hidden;
    }
    .th-label { color:#6b7280; white-space:nowrap; flex-shrink:0; min-width:52px; }
    .th-val { color:#f9fafb; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-align:left; flex:1 1 auto; min-width:0; line-height:1.15; }
    .th-check {
      color:#34d399;
      font-size:13px;
      font-weight:700;
      opacity:0;
      width:0;
      max-width:0;
      margin-left:0;
      overflow:hidden;
      transition:opacity 0.15s, width 0.12s, margin-left 0.12s;
      flex-shrink:0;
    }
    .th-check-visible {
      opacity:1 !important;
      width:21px;
      max-width:21px;
      margin-left:1px;
    }
    .th-controls {
      position: relative;
      display:flex; align-items:center; gap:7px; flex-shrink:0;
    }
    .th-bo-hint {
      position: absolute;
      top: 22px;
      left: -2px;
      display: none;
      align-items: center;
      padding: 1px 6px;
      border-radius: 6px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(17,24,39,0.96);
      color: rgba(248,250,252,0.78);
      font-family: 'Segoe UI', 'Roboto', sans-serif;
      font-size: 9.5px;
      font-weight: 400;
      letter-spacing: 0;
      line-height: 1.15;
      white-space: nowrap;
      pointer-events: auto;
      cursor: pointer;
      z-index: 3;
    }
    .th-bo-hint.is-visible {
      display: inline-flex;
    }
    .th-drag-handle {
      cursor:move; color:#4b5563;
      display:flex; align-items:center; justify-content:center;
      padding:2px 1px;
      margin-left:0;
      margin-top:-2px;
    }
    .th-drag-handle:hover { color:#9ca3af; }
    .th-btn {
      cursor:pointer; background:none; border:none; color:#4b5563;
      padding:0; line-height:0;
      display:flex; align-items:center; justify-content:center;
      transition:color 0.12s;
    }
    .th-btn:hover { color:#f9fafb; }
    .th-bo-btn {
      position: relative;
      width: 23px;
      height: 19px;
    }
    .th-bo-tab-icon {
      position: absolute;
      inset: 0;
      width: 23px;
      height: 19px;
    }
    .th-bo-tab-filled {
      display: none !important;
    }
    .th-bo-tab-number {
      fill: currentColor;
      font-size: 11.2px;
      font-family: 'Arial Black', 'Segoe UI', 'Roboto', 'Arial', sans-serif;
      font-weight: 900;
      font-variant-numeric: tabular-nums lining-nums;
      text-anchor: middle;
      dominant-baseline: auto;
      text-rendering: geometricPrecision;
      paint-order: stroke;
      stroke: currentColor;
      stroke-width: 0.15px;
      letter-spacing: -0.1px;
    }
    .th-bo-btn.is-assigned .th-bo-tab-empty {
      display: none !important;
    }
    .th-bo-btn.is-assigned .th-bo-tab-filled {
      display: block !important;
    }
    .th-bo-btn:hover .th-bo-tab-number {
      color: #f9fafb;
    }
    .th-bo-btn.is-armed {
      color: #f9fafb;
    }
    .th-actions-section {
      margin-top: 5px;
      padding-top: 11px;
      padding-bottom: 2px;
      border-top: 1px solid rgba(255,255,255,0.07);
    }
    .th-actions-grid {
      display: grid;
      width: 100%;
      box-sizing: border-box;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      column-gap: 10px;
      row-gap: 10px;
      padding: 0 3px;
    }
    .th-action-slot {
      aspect-ratio: 4 / 3;
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 8px;
      background: #111827;
      cursor: default;
      margin-top: -1px;
    }
    .th-action-btn {
      cursor: default;
      color: rgba(248,250,252,0.16);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4px 3px;
      text-align: center;
      transition: none;
    }
    .th-action-btn.is-available {
      color: #eef2f7;
      cursor: pointer;
      pointer-events: auto;
      border-color: rgba(255,255,255,0.07);
      background: rgba(255,255,255,0.055);
    }
    .th-action-btn.is-unavailable {
      color: rgba(248,250,252,0.16);
      cursor: default;
      pointer-events: none;
      border-color: rgba(255,255,255,0.07);
      background: #111827;
    }
    .th-action-btn.is-available:hover {
      color: #eef2f7;
      border-color: rgba(255,255,255,0.09);
      background: rgba(255,255,255,0.09);
    }
    .th-action-btn.is-available:active {
      background: rgba(255,255,255,0.04);
    }
    .th-action-text {
      font-size: 14.5px;
      line-height: 1.0;
      font-weight: 300;
      font-family: 'Candara', 'Calibri', 'Segoe UI', sans-serif;
      letter-spacing: 0;
      white-space: normal;
      overflow-wrap: anywhere;
      color: inherit;
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
