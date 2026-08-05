import { Controller, Get, Post, Param, Body, UseGuards, Request } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Throttle({ default: { ttl: 60_000, limit: 30 } })
@Controller('rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  list(@Request() req: { user: { userId: string } }) {
    return this.rooms.listForUser(req.user.userId);
  }

  @Post()
  create(@Body() dto: CreateRoomDto, @Request() req: { user: { userId: string } }) {
    return this.rooms.create(dto, req.user.userId);
  }

  @Post(':name/join')
  join(@Param('name') name: string, @Request() req: { user: { userId: string } }) {
    return this.rooms.join(name, req.user.userId);
  }
}
