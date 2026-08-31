import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateRoomDto } from './create-room.dto';
import { RESERVED_ROOM_NAMES } from '../reserved-room-names';

async function validateName(name: string) {
  const dto = plainToInstance(CreateRoomDto, { name });
  return validate(dto);
}

describe('CreateRoomDto', () => {
  it('accepts a normal lowercase-alphanumeric-hyphen name', async () => {
    const errors = await validateName('team-standup');
    expect(errors).toHaveLength(0);
  });

  it.each(RESERVED_ROOM_NAMES)(
    'rejects the reserved name %p — it would shadow a static client route',
    async (reserved) => {
      const errors = await validateName(reserved);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints).toEqual(
        expect.objectContaining({
          isNotIn: expect.stringContaining('reserved'),
        }),
      );
    },
  );
});
