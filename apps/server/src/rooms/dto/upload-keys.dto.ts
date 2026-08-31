import { IsInt, IsString, IsArray, IsOptional, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ClaimEpochDto {
  @IsInt()
  @Min(0)
  expectedCurrentKeyId!: number;
}

export class GrantUploadItemDto {
  @IsString()
  userId!: string;

  @IsInt()
  @Min(1)
  keyId!: number;

  /** Base64 ciphertext — crypto_box_seal output. */
  @IsString()
  wrappedKey!: string;

  /** Fingerprint the uploader actually sealed against — recorded verbatim, never re-derived server-side. */
  @IsString()
  recipientKeyFp!: string;
}

export class UploadKeysDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ClaimEpochDto)
  claimEpoch?: ClaimEpochDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GrantUploadItemDto)
  grants!: GrantUploadItemDto[];
}
