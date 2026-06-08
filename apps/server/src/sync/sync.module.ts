import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SyncGateway } from './sync.gateway';
import { AuthModule } from '../auth/auth.module';
import { RoomsModule } from '../rooms/rooms.module';

function redisProvider(token: string) {
  return {
    provide: token,
    inject: [ConfigService],
    useFactory: (config: ConfigService) => {
      const IoRedis = require('ioredis');
      return new IoRedis(config.get<string>('REDIS_URL', 'redis://localhost:6379'));
    },
  };
}

@Module({
  imports: [AuthModule, RoomsModule],
  providers: [
    SyncGateway,
    redisProvider('REDIS_PUB'),
    redisProvider('REDIS_SUB'),
  ],
})
export class SyncModule {}
