import { describe, it, expect, vi } from 'vitest';
import { saveMatch, findMatchByPollMessageId } from '../db/matchRepository.js';

/** Creates a mock pg.Pool with a configurable query function. */
const createMockPool = (queryFn: ReturnType<typeof vi.fn>) =>
  ({ query: queryFn }) as any;

const sampleRow = {
  id: 1,
  poll_message_id: 'MSG123',
  group_name: 'test-group',
  creator: 'sender@lid',
  poll_name: 'Saturday game',
  match_date: new Date('2026-04-25T15:00:00Z'),
  options: ['Yes', 'No'],
  created_at: new Date('2026-04-24T21:00:00Z'),
};

describe('matchRepository', () => {
  describe('saveMatch', () => {
    it('upserts a match and returns the record', async () => {
      const query = vi.fn().mockResolvedValue({ rows: [sampleRow] });
      const pool = createMockPool(query);

      const result = await saveMatch(
        pool, 'MSG123', 'test-group', 'sender@lid',
        'Saturday game', '2026-04-25T15:00:00Z', ['Yes', 'No'],
        '2026-04-24T21:00:00Z',
      );

      expect(result.id).toBe(1);
      expect(result.pollMessageId).toBe('MSG123');
      expect(result.pollName).toBe('Saturday game');
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO match_day.matches'),
        ['MSG123', 'test-group', 'sender@lid', 'Saturday game',
         '2026-04-25T15:00:00Z', ['Yes', 'No'], '2026-04-24T21:00:00Z'],
      );
    });

    it('passes null for empty matchDate', async () => {
      const query = vi.fn().mockResolvedValue({ rows: [{ ...sampleRow, match_date: null }] });
      const pool = createMockPool(query);

      const result = await saveMatch(
        pool, 'MSG123', 'test-group', 'sender@lid',
        'Saturday game', '', ['Yes', 'No'], '2026-04-24T21:00:00Z',
      );

      expect(result.matchDate).toBeNull();
      expect(query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([null]),
      );
    });
  });

  describe('findMatchByPollMessageId', () => {
    it('returns a match when found', async () => {
      const query = vi.fn().mockResolvedValue({ rows: [sampleRow] });
      const pool = createMockPool(query);

      const result = await findMatchByPollMessageId(pool, 'MSG123');

      expect(result).not.toBeNull();
      expect(result!.pollMessageId).toBe('MSG123');
    });

    it('returns null when match is not found', async () => {
      const query = vi.fn().mockResolvedValue({ rows: [] });
      const pool = createMockPool(query);

      const result = await findMatchByPollMessageId(pool, 'UNKNOWN');

      expect(result).toBeNull();
    });
  });
});
