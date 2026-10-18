'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { MAX_IMAGE_PIXELS, readImageDimensions, validateImageDimensions } = require('../electron/image-dimensions.cjs');
const { renderDocument } = require('../electron/exams.cjs');

function png(width, height) {
  const header = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12);
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  header[24] = 8;
  header[25] = 6;
  return header;
}

function segment(marker, payload) {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function sof(width, height, marker = 0xc0) {
  const payload = Buffer.from([8, 0, 0, 0, 0, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  payload.writeUInt16BE(height, 1);
  payload.writeUInt16BE(width, 3);
  return segment(marker, payload);
}

function jpeg(width, height, marker = 0xc0, prefix = []) {
  return Buffer.concat([Buffer.from([0xff, 0xd8]), ...prefix, sof(width, height, marker), Buffer.from([0xff, 0xd9])]);
}

test('reads real canvas PNG and JPEG dimensions without invoking image decoding', () => {
  const canvas = createCanvas(683, 947);
  assert.deepEqual(validateImageDimensions(canvas.toBuffer('image/png'), '.png'), { width: 683, height: 947 });
  assert.deepEqual(validateImageDimensions(canvas.toBuffer('image/jpeg'), '.jpg'), { width: 683, height: 947 });
  assert.deepEqual(validateImageDimensions(canvas.toBuffer('image/jpeg'), '.JPEG'), { width: 683, height: 947 });
});

test('JPEG skips EXIF, JFIF, comments and table segments rather than mistaking embedded marker bytes for SOF', () => {
  const embedded = Buffer.concat([Buffer.from('Exif\0\0'), sof(65000, 65000)]);
  const data = jpeg(1200, 1800, 0xc0, [
    segment(0xe0, Buffer.from('JFIF\0')),
    segment(0xe1, embedded),
    segment(0xfe, Buffer.from('camera comment')),
    segment(0xdb, Buffer.alloc(64)),
    segment(0xc4, Buffer.alloc(20)),
    Buffer.from([0xff]), // Legal fill byte before the next marker.
  ]);
  assert.deepEqual(validateImageDimensions(data, '.jpg'), { width: 1200, height: 1800 });
});

test('JPEG recognizes baseline, progressive and other SOF variants', () => {
  for (const marker of [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]) {
    assert.deepEqual(readImageDimensions(jpeg(800, 1200, marker), '.jpeg'), { width: 800, height: 1200 });
  }
  const data = jpeg(800, 1200, 0xc2, [Buffer.from([0xff, 0x01, 0xff, 0xd0])]);
  assert.deepEqual(readImageDimensions(data, '.jpg'), { width: 800, height: 1200 });
});

test('enforces the 40 million pixel boundary before native decode for PNG and JPEG', () => {
  assert.equal(MAX_IMAGE_PIXELS, 40000000);
  for (const [extension, make] of [['.png', png], ['.jpg', jpeg]]) {
    assert.deepEqual(validateImageDimensions(make(8000, 5000), extension), { width: 8000, height: 5000 });
    assert.throws(() => validateImageDimensions(make(8000, 5001), extension), /4000 万像素/);
  }
  assert.throws(() => validateImageDimensions(png(0x7fffffff, 0x7fffffff), '.png'), /4000 万像素/);
  assert.throws(() => validateImageDimensions(jpeg(65535, 65535), '.jpg'), /4000 万像素/);
});

test('PNG rejects wrong signature, missing or misplaced IHDR, invalid dimensions and malformed fields', () => {
  const badSignature = png(10, 10); badSignature[0] = 0;
  const badChunk = png(10, 10); badChunk.write('IDAT', 12);
  const badLength = png(10, 10); badLength.writeUInt32BE(14, 8);
  const badDepth = png(10, 10); badDepth[24] = 1;
  const badCompression = png(10, 10); badCompression[26] = 1;
  const badInterlace = png(10, 10); badInterlace[28] = 2;
  for (const data of [Buffer.alloc(0), png(10, 10).subarray(0, 32), badSignature, badChunk, badLength, badDepth, badCompression, badInterlace, png(0, 10), png(10, 0), png(0x80000000, 1)]) {
    assert.throws(() => validateImageDimensions(data, '.png'), /尺寸信息/);
  }
});

test('JPEG rejects truncation, impossible segment sizes, absent SOF and zero dimensions', () => {
  const valid = jpeg(10, 20);
  const incorrectComponents = jpeg(10, 20); incorrectComponents[11] = 4;
  const incorrectSofLength = jpeg(10, 20); incorrectSofLength.writeUInt16BE(10, 4);
  const shortSegment = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 1]);
  const longSegment = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]);
  for (const data of [Buffer.alloc(0), valid.subarray(0, 4), valid.subarray(0, 10), incorrectComponents, incorrectSofLength, shortSegment, longSegment, jpeg(0, 10), jpeg(10, 0), Buffer.from([0xff, 0xd8, 0xff, 0xda]), Buffer.from([0xff, 0xd8, 0xff, 0xd9]), Buffer.from([0xff, 0xd8, 0xff, 0x00]), Buffer.from([0xff, 0xd8, 0xff, 0xff])]) {
    assert.throws(() => validateImageDimensions(data, '.jpg'), /尺寸信息/);
  }
});

test('rejects unsupported formats and non-buffer input', () => {
  assert.throws(() => validateImageDimensions(png(10, 10), '.gif'), /尺寸信息/);
  assert.throws(() => validateImageDimensions('not an image', '.jpg'), /尺寸信息/);
  assert.throws(() => validateImageDimensions(png(10, 10), '.jpg'), /尺寸信息/);
});

test('document worker rejects huge advertised dimensions before native decoding', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wen-image-dimensions-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('wen-image-dimensions-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  for (const [extension, data] of [['.png', png(65535, 65535)], ['.jpg', jpeg(65535, 65535)]]) {
    const source = path.join(directory, `oversized${extension}`);
    await fs.writeFile(source, data);
    await assert.rejects(renderDocument({ source, extension, outputDirectory: directory, prefix: 'output', maxPages: 1 }), /4000 万像素/);
  }
  assert.equal((await fs.readdir(directory)).some((entry) => entry.startsWith('output')), false);
});
