import pg from 'pg';
import { MatchVote } from '../types/events.js';

/** Upserts a vote for a match — one vote per member per match. */
export const saveMatchVote = async (
  pool: pg.Pool,
  matchId: number,
  memberId: number,
  selectedOptions: string[],
  votedAt: string,
): Promise<MatchVote> => {
  const result = await pool.query(
    `INSERT INTO match_day.match_votes (match_id, member_id, selected_options, voted_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (match_id, member_id) DO UPDATE SET
       selected_options = EXCLUDED.selected_options,
       voted_at         = EXCLUDED.voted_at
     RETURNING id, match_id, member_id, selected_options, voted_at`,
    [matchId, memberId, selectedOptions, votedAt],
  );
  return mapRowToMatchVote(result.rows[0]);
};

/** Maps a database row to a MatchVote domain object. */
const mapRowToMatchVote = (row: Record<string, unknown>): MatchVote => ({
  id: row.id as number,
  matchId: row.match_id as number,
  memberId: row.member_id as number,
  selectedOptions: row.selected_options as string[],
  votedAt: row.voted_at as Date,
});
