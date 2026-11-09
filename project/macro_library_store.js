(() => {
  'use strict';
  if (globalThis.TicketHelperMacroStore) return;
  const DB_NAME = 'ticket-helper-macros';
  const DB_VERSION = 1;
  const FORMAT = 'tickethelper-macros-v1';
  const DEFAULT_SHORTCUT = 'Shift+Space';
  let connection;

  function open() {
    if (!connection) connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('macros')) db.createObjectStore('macros', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return connection;
  }
  function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function transaction(names, mode, callback) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Macro transaction aborted'));
      try { result = callback(tx); } catch (error) { tx.abort(); reject(error); }
    });
  }
  async function list() {
    const db = await open();
    const rows = await requestValue(db.transaction('macros').objectStore('macros').getAll());
    return rows.sort((a, b) => a.id - b.id);
  }
  async function get(id) {
    const db = await open();
    return requestValue(db.transaction('macros').objectStore('macros').get(Number(id)));
  }
  async function image(id) {
    const db = await open();
    return requestValue(db.transaction('images').objectStore('images').get(id));
  }
  async function save(row) {
    if (!row || typeof row.abbreviation !== 'string' || !row.abbreviation.trim() ||
        row.abbreviation.length > 50 ||
        /[\r\n ]/.test(row.abbreviation) || typeof row.html !== 'string')
      throw new Error('Macro inválida.');
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['macros', 'meta'], 'readwrite');
      const meta = tx.objectStore('meta');
      let id;
      tx.oncomplete = () => resolve(id);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Macro transaction aborted'));
      const request = meta.get('nextId');
      request.onsuccess = () => {
        const nextId = request.result?.value || 1;
        id = Number.isSafeInteger(row.id) && row.id > 0 ? row.id : nextId;
        tx.objectStore('macros').put({ id, abbreviation: row.abbreviation.trim(), html: row.html });
        meta.put({ key: 'nextId', value: Math.max(id + 1, nextId) });
      };
    });
  }
  async function remove(id) {
    await transaction(['macros'], 'readwrite', tx => tx.objectStore('macros').delete(Number(id)));
    await pruneImages();
  }
  async function pruneImages() {
    const rows = await list();
    const used = new Set(rows.flatMap(row =>
      [...row.html.matchAll(/data-th-image-id="([a-f0-9-]+)"/gi)].map(match => match[1])));
    const db = await open();
    const keys = await requestValue(db.transaction('images').objectStore('images').getAllKeys());
    await transaction(['images'], 'readwrite', tx => {
      for (const key of keys) if (!used.has(key)) tx.objectStore('images').delete(key);
    });
  }
  async function putImage(blob) {
    if (!(blob instanceof Blob) || !blob.type.startsWith('image/')) throw new Error('Imagem inválida.');
    const id = crypto.randomUUID();
    await transaction(['images'], 'readwrite', tx => tx.objectStore('images').put({ id, blob }));
    return id;
  }
  async function replaceAll(rows, images) {
    const ids = new Set();
    for (const row of rows) {
      if (!Number.isSafeInteger(row.id) || row.id <= 0 || ids.has(row.id) ||
          typeof row.abbreviation !== 'string' || !row.abbreviation.trim() ||
          row.abbreviation.length > 50 ||
          /[\r\n ]/.test(row.abbreviation) || typeof row.html !== 'string')
        throw new Error('Arquivo contém macros inválidas.');
      ids.add(row.id);
    }
    await transaction(['macros', 'images', 'meta'], 'readwrite', tx => {
      const macros = tx.objectStore('macros');
      const assets = tx.objectStore('images');
      macros.clear(); assets.clear();
      for (const row of rows) macros.put(row);
      for (const asset of images) assets.put(asset);
      tx.objectStore('meta').put({ key: 'nextId', value: Math.max(1, ...rows.map(row => row.id + 1)) });
    });
  }
  function activeIndex(rows) {
    const entries = [];
    const winners = new Map();
    for (const row of [...rows].sort((a, b) => a.id - b.id)) {
      const key = row.abbreviation.toLocaleLowerCase();
      if (!winners.has(key) && row.html) winners.set(key, row.id);
      entries.push({ id: row.id, abbreviation: row.abbreviation,
        activeId: winners.get(key) || null });
    }
    return entries;
  }
  globalThis.TicketHelperMacroStore = { FORMAT, DEFAULT_SHORTCUT, open, list, get,
    image, save, remove, putImage, pruneImages, replaceAll, activeIndex };
})();
