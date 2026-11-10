(() => {
  'use strict';
  const store = globalThis.TicketHelperMacroStore;
  if (!store) return;
  let localRevision = 0;
  async function imageData(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return `data:${blob.type};base64,${btoa(binary)}`;
  }
  function dataImage(value) {
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/i.exec(value || '');
    if (!match) throw new Error('Não foi possível guardar uma imagem selecionada.');
    const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
    return new Blob([bytes], { type: match[1].toLowerCase() });
  }
  async function capturedAsset(asset) {
    if (!/^[a-f0-9-]+$/i.test(asset?.id || '')) throw new Error('Imagem selecionada inválida.');
    let blob;
    if (typeof asset.data === 'string') blob = dataImage(asset.data);
    else if (typeof asset.url === 'string' && /^https?:\/\//i.test(asset.url)) {
      const response = await fetch(asset.url, { credentials: 'include' });
      if (!response.ok) throw new Error('Não foi possível guardar uma imagem selecionada.');
      blob = await response.blob();
    } else throw new Error('Não foi possível guardar uma imagem selecionada.');
    if (!/^image\/(?:png|jpeg|webp|gif)$/i.test(blob.type))
      throw new Error('Formato de imagem selecionada não suportado.');
    return { id: asset.id, blob };
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (!['TH_MACRO_GET_INDEX', 'TH_MACRO_GET_RECORD',
      'TH_MACRO_SAVE_CAPTURE', 'TH_MACRO_LIBRARY_CHANGED'].includes(message?.action)) return;
    (async () => {
      if (message.action === 'TH_MACRO_LIBRARY_CHANGED') {
        localRevision = Math.max(Date.now(), localRevision + 1);
        await chrome.storage.local.set({ macroLibraryRevision: localRevision });
        return { ok: true };
      }
      if (message.action === 'TH_MACRO_SAVE_CAPTURE') {
        const abbreviation = String(message.abbreviation || '');
        if (!globalThis.TicketHelperMacroCore.validAbbreviation(abbreviation) ||
            typeof message.html !== 'string' || !message.html.trim() ||
            !Array.isArray(message.images)) throw new Error('Abreviação ou conteúdo inválido.');
        const images = await Promise.all(message.images.map(capturedAsset));
        const ids = new Set(images.map(asset => asset.id));
        for (const match of message.html.matchAll(/data-th-image-id="([a-f0-9-]+)"/gi)) {
          if (!ids.has(match[1]) && !(await store.image(match[1]))?.blob)
            throw new Error('Uma imagem selecionada não está disponível.');
        }
        const rows = await store.list();
        const exact = rows.find(row => row.abbreviation.toLocaleLowerCase() ===
          abbreviation.toLocaleLowerCase());
        const id = Number.isSafeInteger(message.id) && message.id > 0 ? message.id : exact?.id;
        const savedId = await store.saveCaptured({ id, abbreviation, html: message.html, images });
        localRevision = Math.max(Date.now(), localRevision + 1);
        await chrome.storage.local.set({ macroLibraryRevision: localRevision });
        return { ok: true, id: savedId };
      }
      const rows = await store.list();
      const index = store.activeIndex(rows);
      if (message.action === 'TH_MACRO_GET_INDEX') return { index: index.map(item => ({
        ...item, html: rows.find(row => row.id === item.id)?.html || ''
      })) };
      const id = Number(message.id);
      const row = rows.find(item => item.id === id);
      if (!row?.html) return { row: null };
      const images = [];
      for (const match of row.html.matchAll(/data-th-image-id="([a-f0-9-]+)"/gi)) {
        const asset = await store.image(match[1]);
        if (!asset?.blob) return { row: null };
        images.push({ id: match[1], data: await imageData(asset.blob) });
      }
      return { row, images };
    })().then(respond, error => respond({ error: String(error?.message || error) }));
    return true;
  });
})();
