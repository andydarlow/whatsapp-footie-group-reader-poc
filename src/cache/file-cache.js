import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

// JSON replacer/reviver so that Uint8Array / Buffer values survive serialisation.
// Stored as { __type: 'Buffer', data: '<base64>' }.
/**
 * JSON replacer that serialises Uint8Array/Buffer values as
 * `{ __type: 'Buffer', data: '<base64>' }` so they survive a JSON round-trip.
 */
function replacer(_key, value) {
  if (value instanceof Uint8Array) {
    return { __type: 'Buffer', data: Buffer.from(value).toString('base64') };
  }
  return value;
}

/**
 * JSON reviver that restores values previously serialised by `replacer`
 * back into Buffer instances.
 */
function reviver(_key, value) {
  if (value?.__type === 'Buffer' && typeof value.data === 'string') {
    return Buffer.from(value.data, 'base64');
  }
  return value;
}

/**
 * Converts an arbitrary cache key into a safe filename by replacing any
 * character that is not alphanumeric, underscore, or hyphen with `_`.
 * @param {string} key
 * @returns {string} filename ending in `.json`
 */
function keyToFilename(key) {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
}

/**
 * Creates a write-through cache backed by both an in-memory Map and individual
 * JSON files on disk. Reads hit memory first; on a miss the file is loaded and
 * the result is promoted to memory. Writes update memory and the file atomically.
 *
 * Buffer/Uint8Array values are preserved across serialisation via base64 encoding.
 *
 * @param {string} dir - Directory where cache files are stored.
 * @returns {{ init: Function, get: Function, set: Function }}
 */
export function createFileCache(dir) {
  const memory = new Map();

  /** Creates the cache directory if it does not already exist. */
  async function init() {
    await mkdir(dir, { recursive: true });
  }

  /**
   * Retrieves a cached value by key. Checks memory first, then the filesystem.
   * @param {string} key
   * @returns {Promise<any>} The cached value, or `undefined` if not found.
   */
  async function get(key) {
    if (memory.has(key)) return memory.get(key);
    try {
      const raw   = await readFile(join(dir, keyToFilename(key)), 'utf8');
      const value = JSON.parse(raw, reviver);
      memory.set(key, value);
      return value;
    } catch {
      return undefined;
    }
  }

  /**
   * Stores a value in the cache, writing to both memory and the filesystem.
   * @param {string} key
   * @param {any}    value - Must be JSON-serialisable (Buffer/Uint8Array supported).
   */
  async function set(key, value) {
    memory.set(key, value);
    await writeFile(join(dir, keyToFilename(key)), JSON.stringify(value, replacer), 'utf8');
  }

  return { init, get, set };
}
