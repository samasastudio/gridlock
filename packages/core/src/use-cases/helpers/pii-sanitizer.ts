const EMAIL_PII_PATTERN =
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_PII_PATTERN =
  /(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\b\d{3})[-.\s]\d{3}[-.\s]\d{4}\b(?:\s*(?:ext\.?|x)\s*\d+)?/gi;
const LABELED_RESIDENTIAL_ADDRESS_PATTERN =
  /\b(?:Residential|Home|Personal)\s+Address\s*:\s*[^.;\n]+/gi;
const RESIDENTIAL_ADDRESS_INDICATOR_PATTERN =
  /\b(?:apt\.?|apartment|unit|lot|residence|residential|home\s+address|private\s+residence|single-family|condo)\b/i;

export function sanitizeTextPii(raw: string): string {
  return raw
    .replace(LABELED_RESIDENTIAL_ADDRESS_PATTERN, "[REDACTED_ADDRESS]")
    .replace(EMAIL_PII_PATTERN, "[REDACTED_EMAIL]")
    .replace(PHONE_PII_PATTERN, "[REDACTED_PHONE]")
    .trim();
}

export function sanitizeLocationAddressPii(
  addressPartsOrText: string | string[]
): string {
  const parts = Array.isArray(addressPartsOrText)
    ? addressPartsOrText.map((p) => p.trim()).filter(Boolean)
    : addressPartsOrText
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);

  const joined = parts.join(", ");
  if (!RESIDENTIAL_ADDRESS_INDICATOR_PATTERN.test(joined)) {
    return sanitizeTextPii(joined);
  }

  if (Array.isArray(addressPartsOrText) && parts.length >= 2) {
    const cityStateZip = sanitizeTextPii(parts[parts.length - 1]!);
    return `[REDACTED_ADDRESS], ${cityStateZip}`;
  }

  const cityStateMatch = /([A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)$/.exec(
    joined
  );
  if (cityStateMatch) {
    return `[REDACTED_ADDRESS], ${sanitizeTextPii(cityStateMatch[1]!)}`;
  }

  return "[REDACTED_ADDRESS]";
}
