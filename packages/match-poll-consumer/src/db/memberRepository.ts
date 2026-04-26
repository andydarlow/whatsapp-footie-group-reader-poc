import pg from 'pg';
import { Member } from '../types/events.js';

/** Finds a member by their WhatsApp ID, returns null if not found. */
export const findMemberByWhatsappId = async (
  pool: pg.Pool,
  whatsappId: string,
): Promise<Member | null> => {
  const result = await pool.query(
    'SELECT id, whatsapp_id, name, created_at FROM match_day.members WHERE whatsapp_id = $1',
    [whatsappId],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    whatsappId: row.whatsapp_id,
    name: row.name,
    createdAt: row.created_at,
  };
};

/** Creates a new member and returns the created record. */
export const createMember = async (
  pool: pg.Pool,
  whatsappId: string,
  name: string,
): Promise<Member> => {
  const result = await pool.query(
    `INSERT INTO match_day.members (whatsapp_id, name)
     VALUES ($1, $2)
     RETURNING id, whatsapp_id, name, created_at`,
    [whatsappId, name],
  );
  const row = result.rows[0];
  return {
    id: row.id,
    whatsappId: row.whatsapp_id,
    name: row.name,
    createdAt: row.created_at,
  };
};

/** Finds an existing member or creates a new one if not found. */
export const findOrCreateMember = async (
  pool: pg.Pool,
  whatsappId: string,
  name: string,
): Promise<Member> => {
  const existing = await findMemberByWhatsappId(pool, whatsappId);
  if (existing) return existing;
  return createMember(pool, whatsappId, name);
};
