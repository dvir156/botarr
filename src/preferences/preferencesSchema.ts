import { z } from 'zod';

export const UserPreferencesSchema = z.object({
  preferredResolution: z.enum(['2160p', '1080p', 'any']).default('any'),
  preferHevc: z.boolean().nullable().default(null),

  /** Keywords that should cause a release to be avoided (case-insensitive substring match). */
  blockKeywords: z.array(z.string().trim().min(1)).default(['cam', 'telesync', 'ts', 'hc']),
  /** Keywords that should be preferred when choosing between similar releases. */
  preferKeywords: z.array(z.string().trim().min(1)).default([]),

  maxSizeGb: z.number().positive().nullable().default(null),
  minSeeders: z.number().int().nonnegative().nullable().default(null),

  /** Preferred audio/subtitle language hint (freeform; e.g. "en", "english"). */
  language: z.string().trim().min(1).nullable().default(null),

  /** Short freeform rules to inject into the system prompt. */
  notes: z.string().trim().min(1).max(600).nullable().default(null)
});

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

export const UserPreferencesPatchSchema = UserPreferencesSchema.partial();
export type UserPreferencesPatch = z.infer<typeof UserPreferencesPatchSchema>;

export function defaultUserPreferences(): UserPreferences {
  return UserPreferencesSchema.parse({});
}

