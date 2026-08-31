import { IsString, MinLength, MaxLength, Matches, IsNotIn } from 'class-validator';
import { RESERVED_ROOM_NAMES } from '../reserved-room-names';

export class CreateRoomDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(/^[a-z0-9-]+$/, { message: 'name must be lowercase alphanumeric + hyphens' })
  @IsNotIn(RESERVED_ROOM_NAMES, { message: `name is reserved (${RESERVED_ROOM_NAMES.join(', ')})` })
  name!: string;
}
