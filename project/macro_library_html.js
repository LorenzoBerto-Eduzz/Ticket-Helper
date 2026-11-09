(() => {
  'use strict';
  if (globalThis.TicketHelperMacroHTML) return;
  const TAGS = new Set(['P','DIV','BR','SPAN','B','STRONG','I','EM','U','S','STRIKE',
    'OL','UL','LI','BLOCKQUOTE','PRE','A','SUB','SUP','IMG','FONT']);
  const STYLES = new Set(['color','background-color','font-size','font-family','text-align']);
  function cleanStyle(input) {
    return String(input || '').split(';').map(rule => rule.trim()).filter(Boolean).flatMap(rule => {
      const at = rule.indexOf(':');
      if (at < 1) return [];
      const key = rule.slice(0, at).trim().toLowerCase();
      const value = rule.slice(at + 1).trim();
      if (!STYLES.has(key) || !/^[\w\s.,#()%+-]{1,80}$/.test(value) ||
          /url|expression|var\s*\(/i.test(value)) return [];
      return [`${key}: ${value}`];
    }).join('; ');
  }
  function safeUrl(value, image = false) {
    const url = String(value || '').trim();
    if (image && (/^th-image:[a-f0-9-]+$/i.test(url) ||
        /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(url))) return url;
    if (/^https?:\/\//i.test(url)) return url;
    if (!image && /^mailto:/i.test(url)) return url;
    return '';
  }
  function sanitize(html) {
    const source = document.createElement('template');
    source.innerHTML = String(html || '');
    const result = document.createElement('div');
    function append(parent, node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = node.textContent.replace(/\r\n?/g, '\n');
        if (node.parentElement?.closest('p,div,li,span,blockquote,pre') && value.includes('\n')) {
          value.split('\n').forEach((line, index) => {
            if (index) parent.appendChild(document.createElement('br'));
            if (line) parent.appendChild(document.createTextNode(line));
          });
        } else parent.appendChild(document.createTextNode(value));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (!TAGS.has(node.tagName)) {
        if (['SCRIPT','STYLE','SVG','IFRAME','OBJECT'].includes(node.tagName)) return;
        for (const child of [...node.childNodes]) append(parent, child);
        return;
      }
      const clean = document.createElement(node.tagName === 'FONT' ? 'span' : node.tagName.toLowerCase());
      let style = cleanStyle(node.getAttribute('style'));
      if (node.tagName === 'FONT') {
        const color = node.getAttribute('color');
        const size = Number(node.getAttribute('size'));
        const face = node.getAttribute('face');
        if (color && /^#[a-f0-9]{3,8}$/i.test(color)) style += `; color: ${color}`;
        if (size >= 1 && size <= 7) style += `; font-size: ${[0,10,13,16,18,24,32,48][size]}px`;
        if (face && /^[\w\s,-]{1,60}$/.test(face)) style += `; font-family: ${face}`;
      }
      const align = node.getAttribute('align');
      if (align && /^(left|center|right|justify)$/i.test(align)) style += `; text-align: ${align}`;
      if (style.trim().replace(/^;\s*/, '')) clean.setAttribute('style', style.trim().replace(/^;\s*/, ''));
      if (node.tagName === 'A') {
        const href = safeUrl(node.getAttribute('href'));
        if (href) clean.setAttribute('href', href);
      }
      if (node.tagName === 'IMG') {
        const imageId = node.getAttribute('data-th-image-id');
        const src = imageId && /^[a-f0-9-]+$/i.test(imageId) ? `th-image:${imageId}` :
          safeUrl(node.getAttribute('src'), true);
        if (!src) return;
        clean.setAttribute('src', src);
        if (src.startsWith('th-image:')) clean.setAttribute('data-th-image-id', src.slice(9));
        clean.setAttribute('alt', String(node.getAttribute('alt') || '').slice(0, 200));
      }
      for (const child of [...node.childNodes]) append(clean, child);
      parent.appendChild(clean);
    }
    for (const node of [...source.content.childNodes]) append(result, node);
    return result.innerHTML;
  }
  function normalizeEditorBreaks(editor) {
    const selection = document.getSelection();
    let anchor = selection?.anchorNode;
    let focus = selection?.focusNode;
    let anchorOffset = selection?.anchorOffset;
    let focusOffset = selection?.focusOffset;
    let changedSelection = false;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let current;
    while ((current = walker.nextNode())) if (/[\r\n]/.test(current.data)) nodes.push(current);
    for (const node of nodes) {
      const original = node.data;
      const lines = original.replace(/\r\n?/g, '\n').split('\n');
      const textNodes = lines.map(line => document.createTextNode(line));
      const fragment = document.createDocumentFragment();
      textNodes.forEach((textNode, index) => {
        if (index) fragment.appendChild(document.createElement('br'));
        fragment.appendChild(textNode);
      });
      const map = offset => {
        const prefix = original.slice(0, offset).replace(/\r\n?/g, '\n');
        const line = prefix.split('\n').length - 1;
        return [textNodes[line], prefix.length - prefix.lastIndexOf('\n') - 1];
      };
      if (anchor === node) { [anchor, anchorOffset] = map(anchorOffset); changedSelection = true; }
      if (focus === node) { [focus, focusOffset] = map(focusOffset); changedSelection = true; }
      node.replaceWith(fragment);
    }
    if (changedSelection && anchor?.isConnected && focus?.isConnected)
      selection.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
    return nodes.length > 0;
  }
  function fromPlain(text) {
    const box = document.createElement('div');
    for (const line of String(text).replace(/\r\n?/g, '\n').split('\n')) {
      const p = document.createElement('p');
      if (line) p.textContent = line;
      else p.appendChild(document.createElement('br'));
      box.appendChild(p);
    }
    return box.innerHTML;
  }
  function plain(html) {
    const box = document.createElement('div');
    box.innerHTML = sanitize(html);
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      if (node.tagName === 'IMG') return '';
      if (node.tagName === 'BR') return '\n';
      const text = [...node.childNodes].map(walk).join('');
      if (node.tagName === 'LI') {
        const siblings = [...node.parentElement.children].filter(item => item.tagName === 'LI');
        const prefix = node.parentElement.tagName === 'OL' ?
          `${siblings.indexOf(node) + 1}. ` : '• ';
        return `${prefix}${text === '\n' ? '' : text}\n`;
      }
      if (['P','DIV','LI','BLOCKQUOTE','PRE'].includes(node.tagName))
        return text === '\n' ? '\n' : `${text}\n`;
      return text;
    }
    return [...box.childNodes].map(walk).join('').replace(/\n$/, '');
  }
  const api = { sanitize, normalizeEditorBreaks, fromPlain, plain };
  globalThis.TicketHelperMacroHTML = api;
})();
