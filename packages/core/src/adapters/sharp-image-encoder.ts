import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  SCENARIO_BRANCH_WATERMARK,
  type GeminiInteractionImageBlock,
  type PainterImageEncodeOptions,
  type PainterImageEncodeResult,
  type PainterImageEncoder,
} from "../interfaces/index.ts";

export interface SharpImageEncoderOptions {
  quality?: number;
}

const BASE64_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const ALLOWED_INPUT_FORMATS = new Set(["jpeg", "png", "webp"]);
const MAX_DIMENSION = 4_096;
const MAX_INPUT_PIXELS = MAX_DIMENSION * MAX_DIMENSION;

const GLYPH_3X5: Readonly<Record<string, number>> = {
  A: 0o25755, B: 0o65656, C: 0o34443, D: 0o65556, E: 0o74647, F: 0o74644, G: 0o34553,
  H: 0o55755, I: 0o72227, J: 0o11152, K: 0o55655, L: 0o44447, M: 0o57755, N: 0o65555,
  O: 0o25552, P: 0o65644, Q: 0o25531, R: 0o65665, S: 0o34216, T: 0o72222, U: 0o55557,
  V: 0o55552, W: 0o55775, X: 0o55255, Y: 0o55222, Z: 0o71247, "/": 0o11244, "-": 0o00700,
  ":": 0o02020, ".": 0o00002, "0": 0o75557, "1": 0o26227, "2": 0o71747, "3": 0o71717,
  "4": 0o55711, "5": 0o74716, "6": 0o34757, "7": 0o71122, "8": 0o75757, "9": 0o75716,
};

function wrapBannerLines(text: string, maxCharsPerLine: number): string[] {
  const words = text.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length === 0 || maxCharsPerLine <= 0) {
    return [];
  }
  return words.reduce<string[]>((lines, word) => {
    const slices = Array.from(
      { length: Math.ceil(word.length / maxCharsPerLine) },
      (_, idx) =>
        word.slice(idx * maxCharsPerLine, (idx + 1) * maxCharsPerLine)
    );
    return slices.reduce<string[]>((acc, slice) => {
      const current = acc.at(-1);
      return current !== undefined &&
        current.length + 1 + slice.length <= maxCharsPerLine
        ? [...acc.slice(0, -1), `${current} ${slice}`]
        : [...acc, slice];
    }, lines);
  }, []);
}

function isScaledGlyphInk(
  lines: readonly string[],
  x: number,
  y: number,
  scale: number
): boolean {
  const padX = 2 * scale;
  const padY = scale;
  if (x < padX || y < padY) {
    return false;
  }
  const relX = x - padX;
  const relY = y - padY;
  const lineIdx = Math.floor(relY / (6 * scale));
  const glyphY = Math.floor((relY % (6 * scale)) / scale);
  const charIdx = Math.floor(relX / (4 * scale));
  const glyphX = Math.floor((relX % (4 * scale)) / scale);
  const ch = lines[lineIdx]?.[charIdx];
  if (!ch || ch === " " || glyphX >= 3 || glyphY >= 5) {
    return false;
  }
  const mask = GLYPH_3X5[ch] ?? 0o75557;
  return ((mask >>> ((4 - glyphY) * 3 + (2 - glyphX))) & 1) === 1;
}

function buildBranchBannerRgba(
  width: number,
  height: number,
  watermarkText: string
): { rgba: Buffer; bannerHeight: number } {
  const scale = Math.max(1, Math.floor(width / 180));
  const maxCharsPerLine = Math.max(
    1,
    Math.floor((width - 3 * scale) / (4 * scale))
  );
  const maxLines = Math.max(1, Math.floor((height - scale) / (6 * scale)));
  const lines = wrapBannerLines(watermarkText, maxCharsPerLine).slice(
    0,
    maxLines
  );
  const bannerHeight = Math.min(
    height,
    Math.max(1, lines.length * 6 * scale + scale)
  );
  const rgba = Buffer.from(
    Uint8Array.from({ length: width * bannerHeight * 4 }, (_, byteIdx) => {
      const pxIdx = byteIdx >>> 2;
      const channel = byteIdx & 3;
      const x = pxIdx % width;
      const y = Math.floor(pxIdx / width);
      const pixel = isScaledGlyphInk(lines, x, y, scale)
        ? [245, 242, 235, 255]
        : [158, 42, 43, 255];
      return pixel[channel] ?? 255;
    })
  );
  return { rgba, bannerHeight };
}

function buildRightsXmpPacket(rightsText: string): string {
  const escaped = rightsText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:rights>${escaped}</dc:rights></rdf:Description></rdf:RDF></x:xmpmeta>`;
}

export function createSharpImageEncoder(
  options?: SharpImageEncoderOptions
): PainterImageEncoder {
  const rawQuality =
    typeof options?.quality === "number" && Number.isFinite(options.quality)
      ? options.quality
      : 86;
  const quality = Math.min(100, Math.max(1, Math.round(rawQuality)));

  return async (
    outputImage: GeminiInteractionImageBlock | null | undefined,
    encodeOptions?: PainterImageEncodeOptions
  ): Promise<PainterImageEncodeResult> => {
    const rawBase64 = (outputImage?.data ?? "")
      .replace(/[\r\n]+/g, "")
      .trim();
    if (
      rawBase64.length === 0 ||
      rawBase64.length % 4 !== 0 ||
      !BASE64_RE.test(rawBase64)
    ) {
      return {
        ok: false,
        reason: "Missing or invalid base64 image data in Gemini response",
      };
    }

    const decoded = Buffer.from(rawBase64, "base64");
    if (decoded.byteLength === 0) {
      return {
        ok: false,
        reason: "Decoded Gemini image payload is empty",
      };
    }

    try {
      const metadata = await sharp(decoded, {
        failOn: "error",
        limitInputPixels: MAX_INPUT_PIXELS,
      }).metadata();

      if (!metadata.format || !ALLOWED_INPUT_FORMATS.has(metadata.format)) {
        return {
          ok: false,
          reason: `Unsupported Gemini image format "${metadata.format ?? "unknown"}" (expected jpeg, png, or webp)`,
        };
      }

      const width = metadata.width ?? 0;
      const height = metadata.height ?? 0;
      if (
        width <= 0 ||
        width > MAX_DIMENSION ||
        height <= 0 ||
        height > MAX_DIMENSION
      ) {
        return {
          ok: false,
          reason: `Gemini image dimensions ${width}x${height} exceed ${MAX_DIMENSION}x${MAX_DIMENSION} limit`,
        };
      }

      const basePipeline = sharp(decoded, {
        failOn: "error",
        limitInputPixels: MAX_INPUT_PIXELS,
      });

      const webpBuffer = encodeOptions?.isBranch
        ? await (() => {
            const label =
              encodeOptions.watermarkText !== undefined &&
              encodeOptions.watermarkText !== null &&
              encodeOptions.watermarkText.trim().length > 0
                ? encodeOptions.watermarkText.trim()
                : SCENARIO_BRANCH_WATERMARK;
            const { rgba, bannerHeight } = buildBranchBannerRgba(
              width,
              height,
              label
            );
            return basePipeline
              .composite([
                {
                  input: rgba,
                  raw: { width, height: bannerHeight, channels: 4 },
                  top: 0,
                  left: 0,
                },
              ])
              .withXmp(buildRightsXmpPacket(label))
              .webp({ quality })
              .toBuffer();
          })()
        : await basePipeline.webp({ quality }).toBuffer();

      const sha256 = createHash("sha256").update(webpBuffer).digest("hex");
      return { ok: true, webpBuffer, sha256 };
    } catch (error) {
      return {
        ok: false,
        reason:
          error instanceof Error
            ? `Failed to decode or encode Gemini image payload: ${error.message}`
            : "Failed to decode or encode Gemini image payload",
      };
    }
  };
}

export const sharpImageEncoder: PainterImageEncoder = createSharpImageEncoder();
