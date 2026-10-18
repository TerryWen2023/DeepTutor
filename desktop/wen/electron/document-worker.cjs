'use strict';

// Rendering stays off Electron's UI process. Uploaded documents never execute scripts.
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { validateImageDimensions } = require('./image-dimensions.cjs');

async function render() {
  const { source, extension, outputDirectory, prefix, maxPages } = workerData;
  const data = await fs.readFile(source);
  const pages = [];
  async function save(canvas, pageNumber) {
    const name = `${prefix}-${pageNumber}.png`;
    const image = canvas.toBuffer('image/png');
    if (image.length > 20 * 1024 * 1024) throw new Error('页面图像过大，请降低扫描分辨率后重试。');
    await fs.writeFile(path.join(outputDirectory, name), image);
    pages.push(name);
    parentPort.postMessage({ progress: pages.length });
  }
  if (extension !== '.pdf') {
    validateImageDimensions(data, extension);
    const image = await loadImage(data);
    if (!image.width || !image.height || image.width * image.height > 40000000) throw new Error('图片尺寸过大，请使用不超过 4000 万像素的图片。');
    const scale = Math.min(1, 2400 / Math.max(image.width, image.height));
    const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
    const context = canvas.getContext('2d');
    context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    await save(canvas, 1);
    return pages;
  }
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const assets = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const assetDirectory = name => path.join(assets, name).replaceAll('\\', '/') + '/';
  const task = getDocument({
    data: new Uint8Array(data), isEvalSupported: false, enableXfa: false,
    cMapUrl: assetDirectory('cmaps'), cMapPacked: true,
    standardFontDataUrl: assetDirectory('standard_fonts'),
    wasmUrl: assetDirectory('wasm'), maxImageSize: 40000000, stopAtErrors: true, verbosity: 0,
  });
  try {
    const document = await task.promise;
    if (document.numPages > maxPages) throw new Error(`一份试卷最多归档 30 页，请拆分 PDF 后重试。`);
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, 2400 / Math.max(base.width, base.height)) });
      if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width < 1 || viewport.height < 1) throw new Error('PDF 页面尺寸不正确。');
      const surface = document.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      try {
        await page.render({ canvasContext: surface.context, viewport, background: 'rgb(255,255,255)' }).promise;
        await save(surface.canvas, number);
      } finally { document.canvasFactory.destroy(surface); page.cleanup(); }
    }
    return pages;
  } finally { await task.destroy(); }
}

render().then(pages => parentPort.postMessage({ pages })).catch(error => {
  const message = error.name === 'PasswordException' ? 'PDF 有密码保护，请先导出未加密的副本。' : error.message;
  parentPort.postMessage({ error: /[\u4e00-\u9fff]/.test(message) ? message : '试卷无法读取，请确认 JPG/PNG/PDF 文件完整且未损坏。' });
});
