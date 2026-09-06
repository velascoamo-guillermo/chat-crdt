import { IsInt, IsString, IsArray, IsOptional, ValidateNested, Min, Max, Matches, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { IsWrappedRoomKeyBase64 } from './e2ee-validators';

// Sanity ceilings, not real limits — no room this app supports has anywhere
// near this many members/epochs; these exist purely to reject a malicious or
// buggy oversized payload cheaply, before it reaches the DB (code review
// round 1, Important #6).
const MAX_KEY_ID = 100_000;
const MAX_GRANTS_PER_REQUEST = 1_000;

export class ClaimEpochDto {
  @IsInt()
  @Min(0)
  @Max(MAX_KEY_ID)
  expectedCurrentKeyId!: number;
}

export class GrantUploadItemDto {
  @IsString()
  userId!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_KEY_ID)
  keyId!: number;

  /**
   * Base64 ciphertext — crypto_box_seal(roomKey, recipientPublicKey) output,
   * always exactly 80 decoded bytes (32-byte room key + 48-byte SEALBYTES).
   */
  @IsWrappedRoomKeyBase64()
  wrappedKey!: string;

  /**
   * Fingerprint the uploader actually sealed against — recorded verbatim,
   * never re-derived server-side. BLAKE2b-512 hex digest: always exactly
   * 128 lowercase hex characters (users.service.ts).
   */
  @Matches(/^[0-9a-f]{128}$/, { message: 'recipientKeyFp must be a 128-character lowercase hex BLAKE2b-512 digest' })
  recipientKeyFp!: string;
}

export class UploadKeysDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ClaimEpochDto)
  claimEpoch?: ClaimEpochDto;

  @IsArray()
  @ArrayMaxSize(MAX_GRANTS_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => GrantUploadItemDto)
  grants!: GrantUploadItemDto[];
}
