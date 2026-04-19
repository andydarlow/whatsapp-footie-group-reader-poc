import pg from 'pg';
import { config } from '../config.js';

const pool = new pg.Pool(config.postgres);

/** Initialises the database schema (polls + poll_votes tables). */
export async function initDatabase(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS polls (
      poll_message_id TEXT PRIMARY KEY,
      group_name      TEXT NOT NULL,
      creator         TEXT NOT NULL,
      poll_name       TEXT NOT NULL,
      options         TEXT[] NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS poll_votes (
      id              SERIAL PRIMARY KEY,
      poll_message_id TEXT NOT NULL REFERENCES polls(poll_message_id),
      voter           TEXT NOT NULL,
      voter_name      TEXT NOT NULL,
      selected_options TEXT[] NOT NULL,
      voted_at        TIMESTAMPTZ NOT NULL,
      UNIQUE (poll_message_id, voter)
    );
  `);

  console.log('Database schema initialised.');
}

/** Upserts a poll record. */
export async function savePoll(
  pollMessageId: string,
  groupName: string,
  creator: string,
  pollName: string,
  options: string[],
  createdAt: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO polls (poll_message_id, group_name, creator, poll_name, options, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (poll_message_id) DO UPDATE SET
       poll_name = EXCLUDED.poll_name,
       options   = EXCLUDED.options`,
    [pollMessageId, groupName, creator, pollName, options, createdAt],
  );
}

/** Upserts a poll vote (one vote per voter per poll). */
export async function saveVote(
  pollMessageId: string,
  voter: string,
  voterName: string,
  selectedOptions: string[],
  votedAt: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO poll_votes (poll_message_id, voter, voter_name, selected_options, voted_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (poll_message_id, voter) DO UPDATE SET
       voter_name       = EXCLUDED.voter_name,
       selected_options = EXCLUDED.selected_options,
       voted_at         = EXCLUDED.voted_at`,
    [pollMessageId, voter, voterName, selectedOptions, votedAt],
  );
}

/** Gracefully closes the connection pool. */
export async function closeDatabase(): Promise<void> {
  await pool.end();
}
