import pg from 'pg';
import { Match } from '../types/events.js';

/** Upserts a match record from a poll_created event. Returns the match. */
export const saveMatch = async (
  pool: pg.Pool,
  pollMessageId: string,
  groupName: string,
  creator: string,
  pollName: string,
  matchDate: string,
  options: string[],
  createdAt: string,
): Promise<Match> => {
  const result = await pool.query(
    `INSERT INTO match_day.matches (poll_message_id, group_name, creator, poll_name, match_date, options, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (poll_message_id) DO UPDATE SET
       poll_name  = EXCLUDED.poll_name,
       match_date = EXCLUDED.match_date,
       options    = EXCLUDED.options
     RETURNING id, poll_message_id, group_name, creator, poll_name, match_date, options, created_at`,
    [pollMessageId, groupName, creator, pollName, matchDate || null, options, createdAt],
  );
  return mapRowToMatch(result.rows[0]);
};

/** Finds a match by its poll message ID, returns null if not found. */
export const findMatchByPollMessageId = async (
  pool: pg.Pool,
  pollMessageId: string,
): Promise<Match | null> => {
  const result = await pool.query(
    'SELECT id, poll_message_id, group_name, creator, poll_name, match_date, options, created_at FROM match_day.matches WHERE poll_message_id = $1',
    [pollMessageId],
  );
  if (result.rows.length === 0) return null;
  return mapRowToMatch(result.rows[0]);
};

/** Maps a database row to a Match domain object. */
const mapRowToMatch = (row: Record<string, unknown>): Match => ({
  id: row.id as number,
  pollMessageId: row.poll_message_id as string,
  groupName: row.group_name as string,
  creator: row.creator as string,
  pollName: row.poll_name as string,
  matchDate: row.match_date as Date | null,
  options: row.options as string[],
  createdAt: row.created_at as Date,
});
