import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoomDto } from './dto/create-room.dto';

export interface RoomSummary {
  id: string;
  name: string;
  role: string;
}

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Rooms visible to this user: every explicit RoomMember row, plus a
   * synthetic "default" entry — 'default' is an open lobby (see
   * SyncGateway.handleConnection) that every authenticated user can enter
   * without ever calling POST /rooms/:name/join, so it must always be
   * listed even before any membership row exists for it.
   */
  async listForUser(userId: string): Promise<RoomSummary[]> {
    const memberships = await this.prisma.roomMember.findMany({
      where: { userId },
      include: { room: true },
    });

    const rooms: RoomSummary[] = memberships.map((m) => ({
      id: m.room.id,
      name: m.room.name,
      role: m.role,
    }));

    if (!rooms.some((r) => r.name === 'default')) {
      rooms.push({ id: 'default', name: 'default', role: 'member' });
    }

    return rooms;
  }

  async create(dto: CreateRoomDto, userId: string) {
    const existing = await this.prisma.room.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException(`Room "${dto.name}" already exists`);

    const room = await this.prisma.room.create({ data: { name: dto.name } });
    await this.prisma.roomMember.create({
      data: { roomId: room.id, userId, role: 'admin' },
    });
    return { id: room.id, name: room.name, role: 'admin' };
  }

  async join(roomName: string, userId: string) {
    const room = await this.prisma.room.findUnique({ where: { name: roomName } });
    if (!room) throw new NotFoundException(`Room "${roomName}" not found`);

    const existing = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: room.id, userId } },
    });
    if (existing) return { id: room.id, name: room.name, role: existing.role };

    await this.prisma.roomMember.create({ data: { roomId: room.id, userId } });
    return { id: room.id, name: room.name, role: 'member' };
  }

  async isMember(roomName: string, userId: string): Promise<boolean> {
    const member = await this.prisma.roomMember.findFirst({
      where: { room: { name: roomName }, userId },
    });
    return member !== null;
  }
}
