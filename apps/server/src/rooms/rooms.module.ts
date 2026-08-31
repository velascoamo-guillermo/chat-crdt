import { Module } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { RoomsController } from './rooms.controller';
import { RoomKeysService } from './room-keys.service';
import { RoomKeysController } from './room-keys.controller';

@Module({
  providers: [RoomsService, RoomKeysService],
  controllers: [RoomsController, RoomKeysController],
  exports: [RoomsService, RoomKeysService],
})
export class RoomsModule {}
