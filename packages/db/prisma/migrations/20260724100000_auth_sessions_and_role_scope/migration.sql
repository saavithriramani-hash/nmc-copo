-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────
-- Hand-written constraint (part of the schema of record).
-- Role scope must match the role kind (§2): an HoD is scoped to exactly a
-- department, a programme coordinator to exactly a programme, and every
-- other role is institution-wide (no scope columns). A mis-scoped role
-- assignment is unrepresentable.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "Role" ADD CONSTRAINT "Role_scope_matches_kind" CHECK (
  ("kind" = 'HOD' AND "departmentId" IS NOT NULL AND "programmeId" IS NULL) OR
  ("kind" = 'PROGRAMME_COORDINATOR' AND "programmeId" IS NOT NULL AND "departmentId" IS NULL) OR
  ("kind" IN ('ADMIN', 'PRINCIPAL', 'IQAC', 'FACULTY') AND "departmentId" IS NULL AND "programmeId" IS NULL)
);
