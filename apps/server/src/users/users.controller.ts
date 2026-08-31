import { Controller, Put, Body, UseGuards, Request } from '@nestjs/common';
import { UsersService } from './users.service';
import { SetPublicKeyDto } from './dto/set-public-key.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // ADR-010: "PUT /users/me/public-key" — used both by users registered
  // before this ADR shipped (lazy publish on next login/app start, no
  // keypair to publish at registration time) and by reinstall/new-device
  // republish (Multi-device / reinstall).
  @Put('me/public-key')
  setPublicKey(@Body() dto: SetPublicKeyDto, @Request() req: { user: { userId: string } }) {
    return this.users.setPublicKey(req.user.userId, dto.publicKey);
  }
}
