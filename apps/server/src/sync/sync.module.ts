import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SyncGateway } from './sync.gateway';
import { AuthModule } from '../auth/auth.module';
import { RoomsModule } from '../rooms/rooms.module';
import { MetricsModule } from '../metrics/metrics.module';
import { Redis } from 'ioredis';

function redisProvider(token: string) {
  return {
    provide: token,
    inject: [ConfigService],
    useFactory: (config: ConfigService) => {
      return new Redis(config.get<string>('REDIS_URL', 'redis://localhost:6379'));
    },
  };
}

@Module({
  imports: [AuthModule, RoomsModule, MetricsModule],
  providers: [
    SyncGateway,
    redisProvider('REDIS_PUB'),
    redisProvider('REDIS_SUB'),
  ],
})
export class SyncModule {}
