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
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (!['TH_MACRO_GET_INDEX', 'TH_MACRO_GET_RECORD', 'TH_MACRO_LIBRARY_CHANGED'].includes(message?.action)) return;
    (async () => {
      if (message.action === 'TH_MACRO_LIBRARY_CHANGED') {
        localRevision = Math.max(Date.now(), localRevision + 1);
        await chrome.storage.local.set({ macroLibraryRevision: localRevision });
        return { ok: true };
      }
      const rows = await store.list();
      const index = store.activeIndex(rows);
      if (message.action === 'TH_MACRO_GET_INDEX') return { index: index.map(item => ({
        ...item, html: item.id === item.activeId ? rows.find(row => row.id === item.id)?.html : null
      })) };
      const id = Number(message.id);
      if (!index.some(item => item.id === id && item.activeId === id)) return { row: null };
      const row = rows.find(item => item.id === id);
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
