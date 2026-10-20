'use strict';








function copyWithExecCommand(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch {
    return false;
  }
}

function buildSoftBreakHtml(text) {
  const span = document.createElement('span');
  String(text).split(/\r?\n/).forEach((line, index) => {
    if (index) span.appendChild(document.createElement('br'));
    span.appendChild(document.createTextNode(line));
  });
  return span.outerHTML;
}

function copyRichWithExecCommand(html) {
  const selection = window.getSelection();
  const previousRanges = selection ? [...Array(selection.rangeCount)].map((_, index) =>
    selection.getRangeAt(index).cloneRange()) : [];
  const container = document.createElement('div');
  container.contentEditable = 'true';
  container.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    const range = document.createRange();
    range.selectNodeContents(container);
    selection.removeAllRanges();
    selection.addRange(range);
    return !!document.execCommand('copy');
  } catch {
    return false;
  } finally {
    selection?.removeAllRanges();
    previousRanges.forEach(range => selection?.addRange(range));
    container.remove();
  }
}

async function copyText(text, softBreakLines = false) {
  const value = String(text ?? '');
  if (!value) return false;

  if (softBreakLines) {
    const html = buildSoftBreakHtml(value);
    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([value], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' })
        })]);
        return true;
      }
    } catch {
      // Fall back to a rich selection so the line breaks still paste as <br>.
    }
    return copyRichWithExecCommand(html);
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    
  }

  return copyWithExecCommand(value);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.action !== 'OFFSCREEN_COPY_TEXT') return;

  copyText(msg.value, msg.softBreakLines)
    .then((ok) => sendResponse({ ok: !!ok }))
    .catch(() => sendResponse({ ok: false }));

  return true;
});
