import { z } from "zod";

export const schema = z.object({
  finalLabel: z.string(),
  confidence: z.number(),
  summary: z.string(),
});
