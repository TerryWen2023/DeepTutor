'use strict';

// Inspect dimensions before native image decoding allocates a pixel buffer.
const MAX_IMAGE_PIXELS = 40000000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function invalid() { throw new Error('图片尺寸信息不完整或格式不正确，请重新导出 JPG 或 PNG 后导入。'); }

function pngDimensions(data) {
  // IHDR must be the first chunk and contain exactly 13 bytes, plus its CRC.
  if (data.length < 33 || !data.subarray(0, 8).equals(PNG_SIGNATURE) || data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR') invalid();
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  const bitDepths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!width || !height || width > 0x7fffffff || height > 0x7fffffff || !bitDepths[data[25]]?.includes(data[24]) || data[26] !== 0 || data[27] !== 0 || data[28] > 1) invalid();
  return { width, height };
}

function jpegDimensions(data) {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) invalid();
  let offset = 2;
  while (offset < data.length) {
    if (data[offset++] !== 0xff) invalid();
    // Marker padding may contain more than one 0xff byte.
    while (offset < data.length && data[offset] === 0xff) offset++;
    if (offset >= data.length) invalid();
    const marker = data[offset++];
    // No dimensions were found before entropy-coded scan data or end-of-image.
    if (marker === 0x00 || marker === 0xd8 || marker === 0xd9 || marker === 0xda) invalid();
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > data.length) invalid();
    const length = data.readUInt16BE(offset);
    if (length < 2 || length > data.length - offset) invalid();
    if (JPEG_SOF.has(marker)) {
      if (length < 8) invalid();
      const height = data.readUInt16BE(offset + 3);
      const width = data.readUInt16BE(offset + 5);
      const components = data[offset + 7];
      // SOF stores one three-byte descriptor for each image component.
      if (!width || !height || !components || length !== 8 + 3 * components) invalid();
      return { width, height };
    }
    // APP0/APP1 (JFIF/EXIF), tables, comments and other length-prefixed segments.
    offset += length;
  }
  invalid();
}

function readImageDimensions(data, extension) {
  if (!Buffer.isBuffer(data)) invalid();
  const format = typeof extension === 'string' ? extension.toLowerCase() : '';
  if (format === '.png') return pngDimensions(data);
  if (format === '.jpg' || format === '.jpeg') return jpegDimensions(data);
  invalid();
}

function validateImageDimensions(data, extension) {
  const dimensions = readImageDimensions(data, extension);
  // Division avoids overflow for malformed, extremely large PNG dimensions.
  if (dimensions.width > Math.floor(MAX_IMAGE_PIXELS / dimensions.height)) throw new Error('图片尺寸过大，请使用不超过 4000 万像素的图片。');
  return dimensions;
}

module.exports = { MAX_IMAGE_PIXELS, readImageDimensions, validateImageDimensions };
