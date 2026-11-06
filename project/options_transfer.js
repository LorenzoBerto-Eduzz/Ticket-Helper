(() => {
  'use strict';

  const HEADERS = Object.freeze({
    macros: '1 Autopreenchimento de Macros',
    producers: '2 Avisos de Produtores'
  });
  const MAX_FILE_BYTES = 2_000_000;
  const FILE_KINDS = Object.freeze({
    macros: 'AutopreenchimentoDeMacros',
    producers: 'AvisosDeProdutores'
  });

  function exportFilename(kind, date = new Date()) {
    const section = FILE_KINDS[kind];
    if (!section || !(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new Error('Nome de exportação inválido.');
    }
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    return `TicketHelper-${section}-${day}${month}${year}.txt`;
  }

  function serialize(kind, pairs) {
    const header = HEADERS[kind];
    if (!header || !Array.isArray(pairs)) throw new Error('Tipo de exportação inválido.');
    const lines = [header, ''];
    for (const pair of pairs) {
      if (!Array.isArray(pair) || pair.length !== 2 ||
          pair.some(value => typeof value !== 'string' || /[\r\n]/.test(value))) {
        throw new Error('Há um item que não cabe no formato de texto.');
      }
      lines.push(pair[0], pair[1], '');
    }
    return lines.join('\n');
  }

  function parse(kind, text) {
    const header = HEADERS[kind];
    if (!header || typeof text !== 'string') throw new Error('Arquivo inválido.');
    const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
    if (lines[0] !== header || lines[1] !== '') {
      throw new Error('O arquivo não pertence a esta seção.');
    }
    const pairs = [];
    let index = 2;
    while (index < lines.length) {
      if (index === lines.length - 1 && lines[index] === '') break;
      const key = lines[index++];
      if (!key?.trim() || index >= lines.length) {
        throw new Error('O arquivo tem um item incompleto.');
      }
      const value = lines[index++];
      if (index < lines.length && lines[index++] !== '') {
        throw new Error('O arquivo precisa de uma linha vazia entre os itens.');
      }
      pairs.push([key, value]);
    }
    return pairs;
  }

  async function readFile(file) {
    if (!file || file.size > MAX_FILE_BYTES) throw new Error('Selecione um arquivo .txt de até 2 MB.');
    return file.text();
  }

  function download(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  const api = { HEADERS, serialize, parse, readFile, download, exportFilename };
  globalThis.TicketHelperOptionsTransfer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
