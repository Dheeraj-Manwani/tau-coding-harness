-- Account-level preferences and onboarding state (product tours, motion intro,
-- last effort). Shape is enforced in application code; see
-- api/schemas/preferences.schema.ts.
ALTER TABLE "User" ADD COLUMN "preferences" JSONB NOT NULL DEFAULT '{}';
