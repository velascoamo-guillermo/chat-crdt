-- T15 fix 2: a published public key belongs to exactly one user.
--
-- Keys that predate the duplicate-key check may be shared. For each shared
-- fingerprint keep the OLDEST holder (createdAt, then id) and clear it on
-- every newer account; those republish on their next login (ADR-010
-- reinstall path), which also drops their stale grants.
UPDATE "User" AS u
SET "publicKey" = NULL, "publicKeyFp" = NULL
WHERE u."publicKeyFp" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "User" AS o
    WHERE o."publicKeyFp" = u."publicKeyFp"
      AND (o."createdAt" < u."createdAt" OR (o."createdAt" = u."createdAt" AND o."id" < u."id"))
  );

-- CreateIndex
CREATE UNIQUE INDEX "User_publicKeyFp_key" ON "User"("publicKeyFp");
