import { z } from "zod";

export const Sha256HashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Expected 64-character lowercase hex SHA-256 hash");

export type Sha256Hash = z.infer<typeof Sha256HashSchema>;

export const TdlrProjectNumberSchema = z
  .string()
  .regex(/^TABS\d+$/, "Expected TDLR TABS project number (e.g. TABS2027003697)");

export type TdlrProjectNumber = z.infer<typeof TdlrProjectNumberSchema>;
