import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

const VP8X_RESERVED_OR_ANIM_MASK = 0xc3;
const VP8X_ICCP_FLAG = 0x20;
const VP8X_ALPHA_FLAG = 0x10;
const VP8X_EXIF_FLAG = 0x08;
const VP8X_XMP_FLAG = 0x04;

const BIT_REV_8 = Uint8Array.from({ length: 256 }, (_, b) => {
  const x1 = ((b & 0xf0) >>> 4) | ((b & 0x0f) << 4);
  const x2 = ((x1 & 0xcc) >>> 2) | ((x1 & 0x33) << 2);
  return ((x2 & 0xaa) >>> 1) | ((x2 & 0x55) << 1);
});

const VP8L_FLAT_TREE_HEADER = (() => {
  const toBits = (val: number, count: number): number[] => Array.from({ length: count }, (_, i) => (val >>> i) & 1);
  const flatTreeBits = (alphabetSize: number, codeLengthCount: number): number[] => [
    ...toBits(0, 1),
    ...toBits(codeLengthCount - 4, 4),
    ...Array.from({ length: codeLengthCount }, (_, idx) => toBits(idx === 2 || idx === 11 ? 1 : 0, 3)).flat(),
    ...toBits(0, 1),
    ...Array.from({ length: alphabetSize }, (_, symbolIdx) => (symbolIdx < 256 ? 1 : 0)),
  ];
  const bits = [...toBits(0, 3), ...[280, 256, 256, 256].flatMap((alphabetSize, idx) => flatTreeBits(alphabetSize, idx === 0 ? 18 : 12)), ...toBits(0b00000000_101, 11)];
  return Buffer.from(
    Array.from({ length: 156 }, (_, byteIdx) =>
      Array.from({ length: 8 }, (__, bitIdx) => (bits[byteIdx * 8 + bitIdx] ?? 0) << bitIdx).reduce((a, b) => a | b, 0)
    )
  );
})();

interface RiffChunk {
  fourCc: string;
  data: Buffer;
}

function buildRiffChunk(fourCc: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(fourCc.padEnd(4, " ").slice(0, 4), 0, "ascii");
  header.writeUInt32LE(payload.byteLength, 4);
  return Buffer.concat([header, payload, payload.byteLength % 2 === 1 ? Buffer.from([0x00]) : Buffer.alloc(0)]);
}

function wrapRiffWebpChunks(chunks: readonly Buffer[]): Buffer {
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), ...chunks]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.byteLength, 4);
  return Buffer.concat([header, body]);
}

function readRiffChunks(buf: Buffer, off = 12, acc: readonly RiffChunk[] = []): RiffChunk[] | null {
  if (off === buf.byteLength) return [...acc];
  if (off + 8 > buf.byteLength) return null;
  const [fourCc, size] = [buf.subarray(off, off + 4).toString("ascii"), buf.readUInt32LE(off + 4)];
  const [end, padEnd] = [off + 8 + size, off + 8 + size + (size & 1)];
  if (padEnd > buf.byteLength || ((size & 1) === 1 && buf[end] !== 0)) return null;
  return readRiffChunks(buf, padEnd, [...acc, { fourCc, data: buf.subarray(off + 8, end) }]);
}

function parseBitstreamDims(chunk: RiffChunk): { width: number; height: number; hasAlpha: boolean } | null {
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

function encodeRgbaToLosslessWebp(width: number, height: number, rgba: Buffer): Buffer {
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

function corridorCanvasPixelRgba(x: number, y: number, width: number, height: number, spineX: number, hubY: number): readonly [number, number, number, number] {
  if (x === spineX || (Math.abs(x - spineX) <= 2 && Math.abs(y - hubY) <= 2)) return [44, 53, 57, 255];
  if (x === 0 || x === width - 1 || y === 0 || y === height - 1) return [138, 130, 117, 255];
  if (x % 8 === 0 || y % 6 === 0) return [222, 216, 202, 255];
  return [245, 242, 235, 255];
}

export function createCorridorBaseCanvasWebp(timelineSeed = "texas-corridor-main"): Buffer {
  const [width, height] = [64, 36];
  const digest = createHash("sha256").update(timelineSeed).digest();
  const [spineX, hubY] = [24 + ((digest[0] ?? 0) % 16), 10 + ((digest[1] ?? 0) % 16)];
  const rgba = Buffer.from(
    Array.from({ length: width * height }, (_, i) => corridorCanvasPixelRgba(i % width, Math.floor(i / width), width, height, spineX, hubY)).flat()
  );
  return encodeRgbaToLosslessWebp(width, height, rgba);
}
