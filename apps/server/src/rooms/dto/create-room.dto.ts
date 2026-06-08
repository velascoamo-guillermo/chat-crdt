import { IsString, MinLength, MaxLength, Matches } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(/^[a-z0-9-]+$/, { message: 'name must be lowercase alphanumeric + hyphens' })
  name!: string;
}
