import { describe, it, expect, vi } from 'vitest';
import { saveMatchVote } from '../db/matchVoteRepository.js';

/** Creates a mock pg.Pool with a configurable query function. */
const createMockPool = (queryFn: ReturnType<typeof vi.fn>) =>
  ({ query: queryFn }) as any;

describe('matchVoteRepository', () => {
  describe('saveMatchVote', () => {
    it('upserts a vote and returns the record', async () => {
      const row = {
        id: 1,
        match_id: 10,
        member_id: 5,
        selected_options: ['Yes'],
        voted_at: new Date('2026-04-24T21:14:00Z'),
      };
      const query = vi.fn().mockResolvedValue({ rows: [row] });
      const pool = createMockPool(query);

      const result = await saveMatchVote(
        pool, 10, 5, ['Yes'], '2026-04-24T21:14:00Z',
      );

      expect(result.matchId).toBe(10);
      expect(result.memberId).toBe(5);
      expect(result.selectedOptions).toEqual(['Yes']);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO match_day.match_votes'),
        [10, 5, ['Yes'], '2026-04-24T21:14:00Z'],
      );
    });
  });
});
