import pg from 'pg';
import { config } from '../config.js';

const pool = new pg.Pool(config.postgres);

/** Returns the shared connection pool. */
export const getPool = (): pg.Pool => pool;

/** Gracefully closes the connection pool. */
export const closeDatabase = async (): Promise<void> => {
  await pool.end();
};
