import { IsString, MaxLength } from 'class-validator';
import { IsX25519PublicKeyBase64 } from '../../rooms/dto/e2ee-validators';

export class SetPublicKeyDto {
  /**
   * Base64-encoded X25519 public key — must decode to exactly 32 bytes
   * (code review round 1, Important #6). MaxLength is a cheap early-out
   * before the base64-decode validator runs on pathological input.
   */
  @IsString()
  @MaxLength(64)
  @IsX25519PublicKeyBase64()
  publicKey!: string;
}
