-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "preview" TEXT;

-- Backfill existing rows so old pasted chips render too.
UPDATE "Attachment"
SET "preview" = LEFT("extractedText", 240)
WHERE "extractedText" IS NOT NULL AND "preview" IS NULL;
