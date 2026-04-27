import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export interface FileCache<T = unknown> {
  init(): Promise<void>;
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T): Promise<void>;
}

type JsonReplacerValue = Record<string, unknown> | string | number | boolean | null;

/**
 * JSON replacer that serialises Uint8Array/Buffer values as
 * `{ __type: 'Buffer', data: '<base64>' }` so they survive a JSON round-trip.
 */
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { __type: 'Buffer', data: Buffer.from(value).toString('base64') };
  }
  return value;
}

/**
 * JSON reviver that restores values previously serialised by `replacer`
 * back into Buffer instances.
 */
function reviver(_key: string, value: JsonReplacerValue): unknown {
  if (
    value !== null &&
    typeof value === 'object' &&
    (value as Record<string, unknown>).__type === 'Buffer' &&
    typeof (value as Record<string, unknown>).data === 'string'
  ) {
    return Buffer.from((value as Record<string, unknown>).data as string, 'base64');
  }
  return value;
}

/**
 * Converts an arbitrary cache key into a safe filename by replacing any
 * character that is not alphanumeric, underscore, or hyphen with `_`.
 * @param key
 * @returns filename ending in `.json`
 */
function keyToFilename(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
}

/**
 * Creates a write-through cache backed by both an in-memory Map and individual
 * JSON files on disk. Reads hit memory first; on a miss the file is loaded and
 * the result is promoted to memory. Writes update memory and the file atomically.
 *
 * Buffer/Uint8Array values are preserved across serialisation via base64 encoding.
 *
 * @param dir - Directory where cache files are stored.
 */
export function createFileCache<T = unknown>(dir: string): FileCache<T> {
  const memory = new Map<string, T>();

  /** Creates the cache directory if it does not already exist. */
  async function init(): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  /**
   * Retrieves a cached value by key. Checks memory first, then the filesystem.
   * @returns The cached value, or `undefined` if not found.
   */
  async function get(key: string): Promise<T | undefined> {
    if (memory.has(key)) return memory.get(key);
    try {
      const raw   = await readFile(join(dir, keyToFilename(key)), 'utf8');
      const value = JSON.parse(raw, reviver) as T;
      memory.set(key, value);
      return value;
    } catch {
      return undefined;
    }
  }

  /**
   * Stores a value in the cache, writing to both memory and the filesystem.
   * @param key
   * @param value - Must be JSON-serialisable (Buffer/Uint8Array supported).
   */
  async function set(key: string, value: T): Promise<void> {
    memory.set(key, value);
    await writeFile(join(dir, keyToFilename(key)), JSON.stringify(value, replacer), 'utf8');
  }

  return { init, get, set };
}
