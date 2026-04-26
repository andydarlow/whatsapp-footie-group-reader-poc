import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findMemberByWhatsappId, createMember, findOrCreateMember } from '../db/memberRepository.js';

/** Creates a mock pg.Pool with a configurable query function. */
const createMockPool = (queryFn: ReturnType<typeof vi.fn>) =>
  ({ query: queryFn }) as any;

const sampleRow = {
  id: 1,
  whatsapp_id: '12345@lid',
  name: 'Alice',
  created_at: new Date('2026-01-01'),
};

describe('memberRepository', () => {
  describe('findMemberByWhatsappId', () => {
    it('returns a member when found', async () => {
      const query = vi.fn().mockResolvedValue({ rows: [sampleRow] });
      const pool = createMockPool(query);

      const result = await findMemberByWhatsappId(pool, '12345@lid');

      expect(result).toEqual({
        id: 1,
        whatsappId: '12345@lid',
        name: 'Alice',
        createdAt: new Date('2026-01-01'),
      });
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['12345@lid'],
      );
    });

    it('returns null when member is not found', async () => {
      const query = vi.fn().mockResolvedValue({ rows: [] });
      const pool = createMockPool(query);

      const result = await findMemberByWhatsappId(pool, 'unknown@lid');

      expect(result).toBeNull();
    });
  });

  describe('createMember', () => {
    it('inserts a new member and returns the created record', async () => {
      const query = vi.fn().mockResolvedValue({ rows: [sampleRow] });
      const pool = createMockPool(query);

      const result = await createMember(pool, '12345@lid', 'Alice');

      expect(result.whatsappId).toBe('12345@lid');
      expect(result.name).toBe('Alice');
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO match_day.members'),
        ['12345@lid', 'Alice'],
      );
    });
  });

  describe('findOrCreateMember', () => {
    it('returns existing member without creating', async () => {
      const query = vi.fn().mockResolvedValue({ rows: [sampleRow] });
      const pool = createMockPool(query);

      const result = await findOrCreateMember(pool, '12345@lid', 'Alice');

      expect(result.id).toBe(1);
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('creates a new member when not found', async () => {
      const query = vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [sampleRow] });
      const pool = createMockPool(query);

      const result = await findOrCreateMember(pool, '12345@lid', 'Alice');

      expect(result.id).toBe(1);
      expect(query).toHaveBeenCalledTimes(2);
    });
  });
});
