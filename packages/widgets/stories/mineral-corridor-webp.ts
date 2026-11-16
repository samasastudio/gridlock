const BIT_REV_8 = Uint8Array.from({ length: 256 }, (_, byte) => {
  const x1 = ((byte & 0xf0) >>> 4) | ((byte & 0x0f) << 4);
  const x2 = ((x1 & 0xcc) >>> 2) | ((x1 & 0x33) << 2);
  return ((x2 & 0xaa) >>> 1) | ((x2 & 0x55) << 1);
});

const VP8L_FLAT_TREE = (() => {
  const toBits = (val: number, count: number): number[] =>
    Array.from({ length: count }, (_, idx) => (val >>> idx) & 1);
  const treeBits = (alphabet: number, codeLenCount: number): number[] => [
    ...toBits(0, 1),
    ...toBits(codeLenCount - 4, 4),
    ...Array.from({ length: codeLenCount }, (_, i) => toBits(i === 2 || i === 11 ? 1 : 0, 3)).flat(),
    ...toBits(0, 1),
    ...Array.from({ length: alphabet }, (_, sym) => (sym < 256 ? 1 : 0)),
  ];
  const bits = [
    ...toBits(0, 3),
    ...[280, 256, 256, 256].flatMap((size, i) => treeBits(size, i === 0 ? 18 : 12)),
    ...toBits(0b00000000_101, 11),
  ];
  return Uint8Array.from({ length: 156 }, (_, byteIdx) =>
    Array.from({ length: 8 }, (__, bitIdx) => (bits[byteIdx * 8 + bitIdx] ?? 0) << bitIdx).reduce(
      (acc, bit) => acc | bit,
      0
    )
  );
})();

export function makeMineralCorridorWebpUri(variant: "baseline" | "canonical" | "branch"): string {
  const [width, height] = [240, 135];
  const vp8lLen = 5 + VP8L_FLAT_TREE.byteLength + width * height * 4;
  const bytes = new Uint8Array(20 + vp8lLen + (vp8lLen & 1));
  const view = new DataView(bytes.buffer);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  view.setUint32(4, bytes.byteLength - 8, true);
  bytes.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c], 8);
  view.setUint32(16, vp8lLen, true);
  bytes[20] = 0x2f;
  view.setUint32(21, (((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14) | (1 << 28)) >>> 0, true);
  bytes.set(VP8L_FLAT_TREE, 25);

  for (let y = 0; y < height; y += 1) {
    const ridgeWave = Math.sin(y * 0.09) * 14;
    for (let x = 0; x < width; x += 1) {
      const elev = Math.floor((x * 0.35 + y * 0.55 + Math.cos(x * 0.06) * 9 + ridgeWave) / 22);
      let [r, g, b] = elev % 3 === 0 ? [244, 239, 230] : elev % 3 === 1 ? [234, 228, 215] : [223, 216, 202];
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) [r, g, b] = [138, 130, 117];
      if (Math.abs(x - Math.round(78 + y * 0.42)) <= 1) [r, g, b] = [74, 82, 90];
      if (x >= 96 && x <= 148 && y >= 48 && y <= 82) {
        [r, g, b] = x === 96 || x === 148 || y === 48 || y === 82 ? [24, 24, 27] : [207, 213, 210];
      }
      if (variant !== "baseline" && x >= 154 && x <= 194 && y >= 54 && y <= 88) {
        [r, g, b] = x === 154 || x === 194 || y === 54 || y === 88 ? [24, 24, 27] : [74, 82, 90];
      }
      if (variant === "branch" && (y < 6 || (Math.abs(y - (108 - (x - 40) * 0.28)) <= 1.4 && x > 40))) {
        [r, g, b] = [224, 109, 83];
      }
      const off = 181 + (y * width + x) * 4;
      bytes.set([BIT_REV_8[g] ?? 0, BIT_REV_8[r] ?? 0, BIT_REV_8[b] ?? 0, 0xff], off);
    }
  }

  let binary = "";
  for (let idx = 0; idx < bytes.byteLength; idx += 8192) {
    binary += String.fromCharCode(...bytes.subarray(idx, idx + 8192));
  }
  return `data:image/webp;base64,${globalThis.btoa(binary)}`;
}
