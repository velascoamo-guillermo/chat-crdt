import { IsString, MinLength } from 'class-validator';

export class SetPublicKeyDto {
  /** Base64-encoded X25519 public key. */
  @IsString()
  @MinLength(1)
  publicKey!: string;
}
