CREATE TABLE "Feedback" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "rating" INTEGER NOT NULL CHECK ("rating" BETWEEN 1 AND 5),
  "kind" TEXT NOT NULL DEFAULT 'feedback' CHECK ("kind" IN ('feedback', 'suggestion')),
  "message" TEXT,
  "projectId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'account',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Feedback_userId_createdAt_idx" ON "Feedback"("userId", "createdAt");
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");
ALTER TABLE "Attachment" ADD COLUMN "feedbackId" TEXT;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_single_destination" CHECK ("messageId" IS NULL OR "feedbackId" IS NULL);
CREATE INDEX "Attachment_feedbackId_idx" ON "Attachment"("feedbackId");

-- Reuse the credit ledger and its database-enforced single redemption per user.
INSERT INTO "PromoCode" ("id", "code", "credits", "description", "perUserLimit")
VALUES ('feedback-extra100', 'EXTRA100', 100000000, 'Thank you for sharing feedback', 1)
ON CONFLICT ("code") DO UPDATE SET
  "credits" = 100000000, "perUserLimit" = 1,
  "isActive" = true, "expiresAt" = NULL, "maxRedemptions" = NULL,
  "description" = 'Thank you for sharing feedback';
