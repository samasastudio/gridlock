import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import type { GeminiInteractionImageBlock, PainterImageEncodeResult } from "../../interfaces/index.ts";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const VP8X_RESERVED_OR_ANIM_MASK = 0xc3;
const VP8X_ICCP_FLAG = 0x20;
const VP8X_ALPHA_FLAG = 0x10;
const VP8X_EXIF_FLAG = 0x08;
const VP8X_XMP_FLAG = 0x04;

const GLYPH_3X5: Readonly<Record<string, number>> = {
  A: 0o25755, B: 0o65656, C: 0o34443, D: 0o65556, E: 0o74647, F: 0o74644, G: 0o34553,
  H: 0o55755, I: 0o72227, J: 0o11152, K: 0o55655, L: 0o44447, M: 0o57755, N: 0o65555,
  O: 0o25552, P: 0o65644, Q: 0o25531, R: 0o65665, S: 0o34216, T: 0o72222, U: 0o55557,
  V: 0o55552, W: 0o55775, X: 0o55255, Y: 0o55222, Z: 0o71247, "/": 0o11244, "-": 0o00700,
  ":": 0o02020, ".": 0o00002, "0": 0o75557, "1": 0o26227, "2": 0o71747, "3": 0o71717,
  "4": 0o55711, "5": 0o74716, "6": 0o34757, "7": 0o71122, "8": 0o75757, "9": 0o75716,
};

export const BIT_REV_8 = Uint8Array.from({ length: 256 }, (_, b) => {
  const x1 = ((b & 0xf0) >>> 4) | ((b & 0x0f) << 4);
  const x2 = ((x1 & 0xcc) >>> 2) | ((x1 & 0x33) << 2);
  return ((x2 & 0xaa) >>> 1) | ((x2 & 0x55) << 1);
});

export const VP8L_FLAT_TREE_HEADER = (() => {
  const bits: number[] = [];
  const push = (val: number, count: number): void => {
    Array.from({ length: count }, (_, i) => bits.push((val >>> i) & 1));
  };
  const pushFlat = (alphabetSize: number, numCl: number): void => {
    push(0, 1);
    push(numCl - 4, 4);
    Array.from({ length: numCl }, (_, idx) => push(idx === 2 || idx === 11 ? 1 : 0, 3));
    push(0, 1);
    Array.from({ length: alphabetSize }, (_, s) => push(s < 256 ? 1 : 0, 1));
  };
  push(0, 3);
  [280, 256, 256, 256].forEach((sz, idx) => pushFlat(sz, idx === 0 ? 18 : 12));
  push(0b00000000_101, 11);
  return Buffer.from(
    Array.from({ length: 156 }, (_, byteIdx) =>
      Array.from({ length: 8 }, (__, bitIdx) => (bits[byteIdx * 8 + bitIdx] ?? 0) << bitIdx).reduce((a, b) => a | b, 0)
    )
  );
})();

export interface RiffChunk {
  fourCc: string;
  data: Buffer;
}

export function buildRiffChunk(fourCc: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(fourCc.padEnd(4, " ").slice(0, 4), 0, "ascii");
  header.writeUInt32LE(payload.byteLength, 4);
  return Buffer.concat([header, payload, payload.byteLength % 2 === 1 ? Buffer.from([0x00]) : Buffer.alloc(0)]);
}

export function wrapRiffWebpChunks(chunks: readonly Buffer[]): Buffer {
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), ...chunks]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.byteLength, 4);
  return Buffer.concat([header, body]);
}

export function readRiffChunks(buf: Buffer, off = 12, acc: readonly RiffChunk[] = []): RiffChunk[] | null {
  if (off === buf.byteLength) return [...acc];
  if (off + 8 > buf.byteLength) return null;
  const [fourCc, size] = [buf.subarray(off, off + 4).toString("ascii"), buf.readUInt32LE(off + 4)];
  const [end, padEnd] = [off + 8 + size, off + 8 + size + (size & 1)];
  if (padEnd > buf.byteLength || ((size & 1) === 1 && buf[end] !== 0)) return null;
  return readRiffChunks(buf, padEnd, [...acc, { fourCc, data: buf.subarray(off + 8, end) }]);
}

export function parseBitstreamDims(chunk: RiffChunk): { width: number; height: number; hasAlpha: boolean } | null {
  if (chunk.fourCc === "VP8L" && chunk.data.byteLength >= 6 && chunk.data[0] === 0x2f) {
    const hdr = chunk.data.readUInt32LE(1);
    return (hdr >>> 29) === 0 ? { width: (hdr & 0x3fff) + 1, height: ((hdr >>> 14) & 0x3fff) + 1, hasAlpha: Boolean((hdr >>> 28) & 1) } : null;
  }
  if (chunk.fourCc === "VP8 " && chunk.data.byteLength >= 10 && ((chunk.data[0] ?? 1) & 1) === 0 && chunk.data[3] === 0x9d && chunk.data[4] === 0x01 && chunk.data[5] === 0x2a) {
    const [w, h] = [chunk.data.readUInt16LE(6) & 0x3fff, chunk.data.readUInt16LE(8) & 0x3fff];
    return w > 0 && h > 0 ? { width: w, height: h, hasAlpha: false } : null;
  }
  return null;
}

export function isWebpBuffer(buf: Buffer): boolean {
  if (buf.byteLength < 20 || buf.subarray(0, 4).toString("ascii") !== "RIFF" || buf.subarray(8, 12).toString("ascii") !== "WEBP" || buf.readUInt32LE(4) !== buf.byteLength - 8) {
    return false;
  }
  const chunks = readRiffChunks(buf);
  if (!chunks || chunks.length === 0) return false;
  if (chunks.length === 1) return parseBitstreamDims(chunks[0]!) !== null;
  const vp8x = chunks[0]?.fourCc === "VP8X" && chunks[0].data.byteLength === 10 ? chunks[0].data : null;
  const flags = vp8x?.[0] ?? 0xff;
  if (!vp8x || (flags & VP8X_RESERVED_OR_ANIM_MASK) !== 0 || (vp8x.readUInt32LE(0) >>> 8) !== 0) return false;
  const canvasWidth = ((vp8x[4] ?? 0) | ((vp8x[5] ?? 0) << 8) | ((vp8x[6] ?? 0) << 16)) + 1;
  const canvasHeight = ((vp8x[7] ?? 0) | ((vp8x[8] ?? 0) << 8) | ((vp8x[9] ?? 0) << 16)) + 1;
  const bodyChunks = chunks.slice(1);
  const imgChunks = bodyChunks.filter((c) => c.fourCc === "VP8L" || c.fourCc === "VP8 ");
  const primary = imgChunks.length === 1 ? imgChunks[0]! : null;
  const dims = primary ? parseBitstreamDims(primary) : null;
  if (!primary || !dims || dims.width !== canvasWidth || dims.height !== canvasHeight) return false;
  const hasChunk = (fourCc: string) => bodyChunks.some((c) => c.fourCc === fourCc && c.data.byteLength > 0);
  const expectedAlpha = dims.hasAlpha || (primary.fourCc === "VP8 " && hasChunk("ALPH"));
  return (
    Boolean(flags & VP8X_ICCP_FLAG) === hasChunk("ICCP") &&
    Boolean(flags & VP8X_ALPHA_FLAG) === expectedAlpha &&
    Boolean(flags & VP8X_EXIF_FLAG) === hasChunk("EXIF") &&
    Boolean(flags & VP8X_XMP_FLAG) === hasChunk("XMP ")
  );
}

export function encodeRgbaToLosslessWebp(width: number, height: number, rgba: Buffer): Buffer {
  const vp8lHeader = Buffer.alloc(5);
  vp8lHeader[0] = 0x2f;
  vp8lHeader.writeUInt32LE((((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14) | (1 << 28)) >>> 0, 1);
  const pixelBytes = Buffer.from(
    Uint8Array.from({ length: width * height * 4 }, (_, idx) => {
      const [px, ch] = [(idx >>> 2) * 4, idx & 3];
      return BIT_REV_8[rgba[ch === 0 ? px + 1 : ch === 1 ? px : ch === 2 ? px + 2 : px + 3] ?? 0] ?? 0;
    })
  );
  return wrapRiffWebpChunks([buildRiffChunk("VP8L", Buffer.concat([vp8lHeader, VP8L_FLAT_TREE_HEADER, pixelBytes]))]);
}

function wrapWatermarkLines(text: string, maxCharsPerLine: number): string[] {
  const words = text.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length === 0 || maxCharsPerLine <= 0) return [];
  return words.reduce<string[]>((lines, word) => {
    const slices = Array.from({ length: Math.ceil(word.length / maxCharsPerLine) }, (_, idx) =>
      word.slice(idx * maxCharsPerLine, (idx + 1) * maxCharsPerLine)
    );
    return slices.reduce<string[]>((acc, slice) => {
      const current = acc.at(-1);
      return current !== undefined && current.length + 1 + slice.length <= maxCharsPerLine
        ? [...acc.slice(0, -1), `${current} ${slice}`]
        : [...acc, slice];
    }, lines);
  }, []);
}

function isWatermarkGlyphInk(lines: readonly string[], x: number, y: number): boolean {
  if (x < 2 || y < 1) return false;
  const [lineIdx, glyphY, charIdx, glyphX] = [Math.floor((y - 1) / 6), (y - 1) % 6, Math.floor((x - 2) / 4), (x - 2) % 4];
  const ch = lines[lineIdx]?.[charIdx];
  if (!ch || ch === " " || glyphY >= 5 || glyphX >= 3) return false;
  return (((GLYPH_3X5[ch] ?? 0o75557) >>> ((4 - glyphY) * 3 + (2 - glyphX))) & 1) === 1;
}

function stampFlatVp8lWatermarkBanner(primary: RiffChunk, dims: { width: number; height: number }, watermarkText: string): RiffChunk {
  const flatPrefixLen = 5 + VP8L_FLAT_TREE_HEADER.byteLength;
  const isFlatVp8l =
    primary.fourCc === "VP8L" &&
    primary.data.byteLength === flatPrefixLen + dims.width * dims.height * 4 &&
    primary.data.subarray(5, flatPrefixLen).equals(VP8L_FLAT_TREE_HEADER);
  if (!isFlatVp8l) return primary;
  const visibleLines = wrapWatermarkLines(watermarkText, Math.max(1, Math.floor((dims.width - 3) / 4))).slice(
    0,
    Math.max(1, Math.floor((dims.height - 1) / 6))
  );
  const bannerHeight = visibleLines.length > 0 ? Math.min(dims.height, visibleLines.length * 6 + 1) : 0;
  const rgba = Buffer.from(
    Uint8Array.from({ length: dims.width * dims.height * 4 }, (_, byteIdx) => {
      const [pxIdx, channel] = [byteIdx >>> 2, byteIdx & 3];
      const [x, y] = [pxIdx % dims.width, Math.floor(pxIdx / dims.width)];
      if (y < bannerHeight) return (isWatermarkGlyphInk(visibleLines, x, y) ? [245, 242, 235, 255] : [158, 42, 43, 255])[channel] ?? 255;
      const srcOff = flatPrefixLen + pxIdx * 4;
      const encodedOffset = channel === 0 ? srcOff + 1 : channel === 1 ? srcOff : srcOff + channel;
      return BIT_REV_8[primary.data[encodedOffset] ?? (channel === 3 ? 255 : 0)] ?? 0;
    })
  );
  return readRiffChunks(encodeRgbaToLosslessWebp(dims.width, dims.height, rgba))?.[0] ?? primary;
}

export function applyScenarioBranchWatermarkToWebp(webpBuffer: Buffer, watermarkText: string): Buffer {
  const chunks = readRiffChunks(webpBuffer) ?? [];
  const primary = chunks.find((c) => c.fourCc === "VP8L" || c.fourCc === "VP8 ");
  const primaryDims = primary ? parseBitstreamDims(primary) : null;
  if (!primary || !primaryDims) return webpBuffer;
  const stampedPrimary = stampFlatVp8lWatermarkBanner(primary, primaryDims, watermarkText);
  const stampedDims = parseBitstreamDims(stampedPrimary) ?? primaryDims;
  const iccpChunk = chunks.find((c) => c.fourCc === "ICCP" && c.data.byteLength > 0);
  const alphChunk = chunks.find((c) => c.fourCc === "ALPH" && c.data.byteLength > 0);
  const exifChunk = chunks.find((c) => c.fourCc === "EXIF" && c.data.byteLength > 0);
  const hasLossyAlpha = stampedPrimary.fourCc === "VP8 " && alphChunk !== undefined;
  const hasAlpha = stampedDims.hasAlpha || hasLossyAlpha;
  const vp8x = Buffer.alloc(10);
  vp8x[0] = VP8X_XMP_FLAG | (iccpChunk ? VP8X_ICCP_FLAG : 0) | (hasAlpha ? VP8X_ALPHA_FLAG : 0) | (exifChunk ? VP8X_EXIF_FLAG : 0);
  const [widthMinusOne, heightMinusOne] = [stampedDims.width - 1, stampedDims.height - 1];
  vp8x.set([widthMinusOne & 0xff, (widthMinusOne >>> 8) & 0xff, (widthMinusOne >>> 16) & 0xff, heightMinusOne & 0xff, (heightMinusOne >>> 8) & 0xff, (heightMinusOne >>> 16) & 0xff], 4);
  const escaped = watermarkText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const xmp = Buffer.from(`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:rights>${escaped}</dc:rights></rdf:Description></rdf:RDF></x:xmpmeta>`, "utf-8");
  return wrapRiffWebpChunks([
    buildRiffChunk("VP8X", vp8x),
    ...(iccpChunk ? [buildRiffChunk("ICCP", iccpChunk.data)] : []),
    ...(hasLossyAlpha ? [buildRiffChunk("ALPH", alphChunk.data)] : []),
    buildRiffChunk(stampedPrimary.fourCc, stampedPrimary.data),
    ...(exifChunk ? [buildRiffChunk("EXIF", exifChunk.data)] : []),
    buildRiffChunk("XMP ", xmp),
  ]);
}

export function createCorridorBaseCanvasWebp(lineageSeed = "texas-corridor-main"): Buffer {
  const [width, height] = [64, 36];
  const digest = createHash("sha256").update(lineageSeed).digest();
  const [spineX, hubY] = [24 + ((digest[0] ?? 0) % 16), 10 + ((digest[1] ?? 0) % 16)];
  const rgba = Buffer.alloc(width * height * 4);
  Array.from({ length: width * height }).forEach((_, i) => {
    const [x, y] = [i % width, Math.floor(i / width)];
    const isBorder = x === 0 || x === width - 1 || y === 0 || y === height - 1;
    const isSpine = x === spineX || (Math.abs(x - spineX) <= 2 && Math.abs(y - hubY) <= 2);
    const [r, g, b] = isSpine ? [44, 53, 57] : isBorder ? [138, 130, 117] : x % 8 === 0 || y % 6 === 0 ? [222, 216, 202] : [245, 242, 235];
    rgba.set([r, g, b, 255], i * 4);
  });
  return encodeRgbaToLosslessWebp(width, height, rgba);
}

function paeth(a: number, b: number, c: number): number {
  const [pa, pb, pc] = [Math.abs(b - c), Math.abs(a - c), Math.abs(a + b - 2 * c)];
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function parsePngChunks(buf: Buffer, off = 8, acc: readonly { type: string; data: Buffer }[] = []): { type: string; data: Buffer }[] | null {
  if (off + 12 > buf.byteLength) return null;
  const len = buf.readUInt32BE(off);
  if (off + 12 + len > buf.byteLength) return null;
  const type = buf.subarray(off + 4, off + 8).toString("ascii");
  const next = [...acc, { type, data: buf.subarray(off + 8, off + 8 + len) }];
  return type === "IEND" ? (off + 12 + len === buf.byteLength ? next : null) : parsePngChunks(buf, off + 12 + len, next);
}

function tryInflate(buf: Buffer): Buffer | null {
  try { return inflateSync(buf); } catch { return null; }
}

export function decodePngToRgba(buf: Buffer): { width: number; height: number; rgba: Buffer } | null {
  if (buf.byteLength < 33 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  const chunks = parsePngChunks(buf);
  const ihdr = chunks?.[0]?.type === "IHDR" && chunks[0].data.byteLength === 13 ? chunks[0].data : null;
  if (!chunks || !ihdr) return null;
  const [width, height, cType] = [ihdr.readUInt32BE(0), ihdr.readUInt32BE(4), ihdr[9]];
  const ch = cType === 6 ? 4 : cType === 2 ? 3 : cType === 4 ? 2 : cType === 0 ? 1 : 0;
  if (width <= 0 || width > 4096 || height <= 0 || height > 4096 || ihdr[8] !== 8 || ihdr[10] !== 0 || ihdr[11] !== 0 || ihdr[12] !== 0 || ch === 0) return null;
  const [inflated, stride] = [tryInflate(Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data))), width * ch];
  if (!inflated || inflated.byteLength !== height * (1 + stride)) return null;
  const rows = Array.from({ length: height }).reduce<Uint8Array[] | null>((acc, _, y) => {
    const f = inflated[y * (1 + stride)] ?? 99;
    if (!acc || f > 4) return null;
    const [prev, row] = [y > 0 ? acc[y - 1]! : null, new Uint8Array(stride)];
    Array.from({ length: stride }).forEach((__, i) => {
      const [l, u, ul] = [i >= ch ? (row[i - ch] ?? 0) : 0, prev ? (prev[i] ?? 0) : 0, prev && i >= ch ? (prev[i - ch] ?? 0) : 0];
      row[i] = ((inflated[y * (1 + stride) + 1 + i] ?? 0) + (f === 0 ? 0 : f === 1 ? l : f === 2 ? u : f === 3 ? (l + u) >>> 1 : paeth(l, u, ul))) & 0xff;
    });
    return [...acc, row];
  }, []);
  if (!rows) return null;
  const rgba = Buffer.alloc(width * height * 4);
  rows.forEach((row, y) =>
    Array.from({ length: width }).forEach((_, x) => {
      const [s, d] = [x * ch, (y * width + x) * 4];
      rgba.set([row[s] ?? 0, ch >= 3 ? (row[s + 1] ?? 0) : (row[s] ?? 0), ch >= 3 ? (row[s + 2] ?? 0) : (row[s] ?? 0), ch === 4 ? (row[s + 3] ?? 255) : ch === 2 ? (row[s + 1] ?? 255) : 255], d);
    })
  );
  return { width, height, rgba };
}

export function defaultPainterImageEncoder(outputImage: GeminiInteractionImageBlock | null | undefined): PainterImageEncodeResult {
  const rawBase64 = outputImage?.data?.trim() ?? "";
  if (rawBase64.length === 0 || rawBase64.length % 4 !== 0 || !BASE64_RE.test(rawBase64)) {
    return { ok: false, reason: "Missing or invalid base64 image data in Gemini response" };
  }
  const decoded = Buffer.from(rawBase64, "base64");
  if (isWebpBuffer(decoded)) {
    return { ok: true, webpBuffer: decoded, sha256: createHash("sha256").update(decoded).digest("hex") };
  }
  const decodedPng = decodePngToRgba(decoded);
  if (!decodedPng) return { ok: false, reason: "Corrupt or unsupported image payload in Gemini response (expected valid WebP or 8-bit PNG)" };
  const webpBuffer = encodeRgbaToLosslessWebp(decodedPng.width, decodedPng.height, decodedPng.rgba);
  return { ok: true, webpBuffer, sha256: createHash("sha256").update(webpBuffer).digest("hex") };
}
