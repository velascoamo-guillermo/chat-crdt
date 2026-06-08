import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoomDto } from './dto/create-room.dto';

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

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
