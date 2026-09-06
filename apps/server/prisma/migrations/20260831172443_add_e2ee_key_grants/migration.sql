-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "currentKeyId" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "publicKey" TEXT,
ADD COLUMN     "publicKeyFp" TEXT;

-- CreateTable
CREATE TABLE "RoomKeyGrant" (
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyId" INTEGER NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "recipientKeyFp" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomKeyGrant_pkey" PRIMARY KEY ("roomId","userId","keyId")
);

-- CreateIndex
CREATE INDEX "RoomKeyGrant_userId_idx" ON "RoomKeyGrant"("userId");

-- AddForeignKey
ALTER TABLE "RoomKeyGrant" ADD CONSTRAINT "RoomKeyGrant_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomKeyGrant" ADD CONSTRAINT "RoomKeyGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
