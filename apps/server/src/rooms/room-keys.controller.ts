import { Controller, Get, Post, Param, Body, UseGuards, Request } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RoomKeysService } from './room-keys.service';
import { UploadKeysDto } from './dto/upload-keys.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Throttle({ default: { ttl: 60_000, limit: 60 } })
@Controller('rooms/:id/keys')
export class RoomKeysController {
  constructor(private readonly keys: RoomKeysService) {}

  // ADR-010: caller's own RoomKeyGrant rows for this room, so it can
  // unwrap and cache every granted epoch locally (expo-secure-store).
  @Get()
  myGrants(@Param('id') roomId: string, @Request() req: { user: { userId: string } }) {
    return this.keys.getMyGrants(roomId, req.user.userId);
  }

  @Get('pending')
  pending(@Param('id') roomId: string, @Request() req: { user: { userId: string } }) {
    return this.keys.getPending(roomId, req.user.userId);
  }

  // Recipient public keys for every current member — needed by the
  // enabling/rotating admin to wrap a brand-new epoch's key, since
  // GET .../keys/pending is empty before that epoch exists.
  @Get('members')
  members(@Param('id') roomId: string, @Request() req: { user: { userId: string } }) {
    return this.keys.getMembersWithPublicKeys(roomId, req.user.userId);
  }

  // Serves pending grants (first-responder wrap, any member) when no
  // claimEpoch is present, or atomically claims an epoch (enablement /
  // rotation, admin-only) when it is.
  @Post()
  upload(
    @Param('id') roomId: string,
    @Body() dto: UploadKeysDto,
    @Request() req: { user: { userId: string } },
  ) {
    return this.keys.uploadGrants(roomId, req.user.userId, dto);
  }
}
