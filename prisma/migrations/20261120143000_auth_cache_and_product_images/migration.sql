ALTER TYPE "UserStatus" ADD VALUE 'INACTIVE';

CREATE TYPE "ImageStorageProvider" AS ENUM ('CLOUDINARY', 'S3');

ALTER TABLE "Product"
ADD COLUMN "imageUrl" TEXT,
ADD COLUMN "imageStorageKey" TEXT,
ADD COLUMN "imageStorageProvider" "ImageStorageProvider";

CREATE TABLE "UserSessionRevocationOutbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "blockOperationId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "UserSessionRevocationOutbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserSessionRevocationOutbox_processedAt_nextAttemptAt_idx"
ON "UserSessionRevocationOutbox"("processedAt", "nextAttemptAt");

ALTER TABLE "UserSessionRevocationOutbox"
ADD CONSTRAINT "UserSessionRevocationOutbox_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
