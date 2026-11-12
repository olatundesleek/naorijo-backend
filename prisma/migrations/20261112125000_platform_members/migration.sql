ALTER TYPE "PlatformRole" ADD VALUE IF NOT EXISTS 'PLATFORM_ADMIN';
ALTER TYPE "PlatformRole" ADD VALUE IF NOT EXISTS 'PLATFORM_SUPPORT';
ALTER TYPE "PlatformRole" ADD VALUE IF NOT EXISTS 'PLATFORM_VIEWER';

CREATE TABLE "PlatformMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformMember_pkey" PRIMARY KEY ("id")
);

INSERT INTO "PlatformMember" ("id", "userId", "role", "updatedAt")
SELECT 'platform_' || "id", "id", "platformRole", CURRENT_TIMESTAMP
FROM "User"
WHERE "platformRole" IS NOT NULL;

CREATE UNIQUE INDEX "PlatformMember_userId_key" ON "PlatformMember"("userId");
CREATE INDEX "PlatformMember_status_role_idx" ON "PlatformMember"("status", "role");

ALTER TABLE "PlatformMember"
ADD CONSTRAINT "PlatformMember_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "User" DROP COLUMN "platformRole";
