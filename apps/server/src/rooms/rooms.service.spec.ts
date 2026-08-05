import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  room: {
    findUnique: jest.fn(),
  },
  roomMember: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
  },
};

describe('RoomsService', () => {
  let service: RoomsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [RoomsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(RoomsService);
  });

  describe('listForUser', () => {
    it('returns rooms the user is an explicit member of, mapped to id/name/role', async () => {
      mockPrisma.roomMember.findMany.mockResolvedValue([
        { role: 'admin', room: { id: 'room-1', name: 'my-room' } },
      ]);

      const result = await service.listForUser('user-1');

      expect(mockPrisma.roomMember.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        include: { room: true },
      });
      expect(result).toContainEqual({ id: 'room-1', name: 'my-room', role: 'admin' });
    });

    it('always includes the open "default" lobby even without an explicit membership row', async () => {
      mockPrisma.roomMember.findMany.mockResolvedValue([]);

      const result = await service.listForUser('user-1');

      expect(result).toContainEqual({ id: 'default', name: 'default', role: 'member' });
    });

    it('does not duplicate "default" when the user already has an explicit membership row for it', async () => {
      mockPrisma.roomMember.findMany.mockResolvedValue([
        { role: 'admin', room: { id: 'default-uuid', name: 'default' } },
      ]);

      const result = await service.listForUser('user-1');

      expect(result.filter((r) => r.name === 'default')).toHaveLength(1);
      expect(result).toContainEqual({ id: 'default-uuid', name: 'default', role: 'admin' });
    });
  });

  describe('join', () => {
    it('throws NotFoundException for an unknown room', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(null);
      await expect(service.join('nope', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });
});
