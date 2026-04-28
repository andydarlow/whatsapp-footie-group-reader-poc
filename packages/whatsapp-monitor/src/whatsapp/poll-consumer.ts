/*
  code for extract poll messages from whatsapp, processing them and putting the processed message on the queue
 */
import {
  decryptPollVote,
  type WAMessage,
} from '@whiskeysockets/baileys';
import { createHash } from 'crypto';
import { config } from '../config.js';
import { sendMessage } from '../kafka/producer.js';
import { createFileCache } from '../cache/file-cache.js';
import {MessageContext} from "./client.js";
import pino from 'pino'


const logger = pino({ level: config.logLevel });



// when the game's Kick off time is (usually saturday at 1pm)
interface MatchKickoffTime {
  dayOfWeek:      string;
  dateOfMonth:    string;
  month:          string;
  kickoffTime:    string;
  matchTimestamp: string;
}


interface PollCacheEntry {
  encKey:     Buffer | Uint8Array;
  creatorJid: string;
  pollName:   string;
  options:    string[];
  matchInfo?: MatchKickoffTime;
}

// keeping the poll creation data is necessary so that you can get the Key to decript the poll's vote.
// so keep the data on a local file cache
export const pollKeyCache = createFileCache<PollCacheEntry>(config.cacheDir);

/**
 * Extracts the poll creation message from a message content object regardless
 * of which protobuf version was used. WhatsApp clients emit V1/V2/V3 depending
 * on their version; historical (offline-period) messages may use older variants.
 * @param content - `msg.message` from a Baileys message event
 * @returns The poll creation message, or `null` if not present.
 */
export function getPollCreationMessage(content: NonNullable<WAMessage['message']>) {
  return content.pollCreationMessageV3
    ?? content.pollCreationMessageV2
    ?? content.pollCreationMessage
    ?? null;
}

/** Regex to extract match details from a poll name (e.g. "Saturday 12th April Kickoff 2pm") */
const MATCH_POLL_REGEX = /(Saturday)\s+(\d{1,2}(?:st|nd|rd|th))\s+([A-Z][a-z]+)\b.*?[k|K]ickoff\s+(\d{1,2}(?:\.\d{2})?(?:pm|am)?)/;

/** Month name to zero-based index lookup */
const MONTH_MAP: Record<string, number> = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
  July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
};

/**
 * Parses match info from a poll name using the match poll regex. Returns the
 * extracted fields and a computed ISO timestamp, or `null` if the name doesn't match.
 * @param pollName - The poll name string to parse
 */
function parseMatchInfo(pollName: string): MatchKickoffTime | null {
  const m = MATCH_POLL_REGEX.exec(pollName);
  if (!m) return null;

  const [, dayOfWeek, dateOfMonth, month, kickoffTime] = m;
  const day       = parseInt(dateOfMonth, 10);
  const monthIdx  = MONTH_MAP[month];
  if (monthIdx === undefined) return null;

  const year      = new Date().getFullYear();
  const timeParts = parseKickoffTime(kickoffTime);
  const matchDate = new Date(year, monthIdx, day, timeParts.hours, timeParts.minutes);

  return { dayOfWeek, dateOfMonth, month, kickoffTime, matchTimestamp: matchDate.toISOString() };
}

/**
 * Converts a kickoff time string (e.g. "2pm", "7.30pm", "10.00am") to hours
 * and minutes in 24-hour format.
 * @param time - Kickoff time string
 */
function parseKickoffTime(time: string): { hours: number; minutes: number } {
  const isPm = time.toLowerCase().includes('pm');
  const isAm = time.toLowerCase().includes('am');
  const numeric = time.replace(/[ap]m/i, '');
  const parts   = numeric.split('.');
  let hours     = parseInt(parts[0], 10);
  const minutes = parts.length > 1 ? parseInt(parts[1], 10) : 0;

  if (!isAm && !isPm && hours < 12 ) hours += 12; // just in case it says game at 3:00
  if (isPm && hours < 12) hours += 12;
  if (isAm && hours === 12) hours = 0;

  return { hours, minutes };
}

/**
 * Handles poll creation messages (V1/V2/V3). Caches the poll's encryption key,
 * creator JID, name, and options in `pollKeyCache` so that subsequent votes can
 * be decrypted. Publishes a `poll_created` event to the Kafka poll topic.
 * @param msg     - Baileys message object
 * @param context - Resolved group name, sender JID, and timestamp
 */
export async function handlePollCreation(msg: WAMessage, { groupName, sender, timestamp }: MessageContext): Promise<void> {
  const poll    = getPollCreationMessage(msg.message!)!;
  const options = poll.options?.map((o) => o.optionName ?? '') ?? [];
  const pollName = poll.name ?? '';

  const matchKickoffTime = parseMatchInfo(pollName);
  if (!matchKickoffTime) {
    logger.info(`[poll] Skipping non-match poll: "${pollName}"`);
    return;
  }

  await pollKeyCache.set(msg.key.id!, {
    encKey:     msg.message!.messageContextInfo?.messageSecret as Buffer,
    creatorJid: sender,
    pollName,
    options,
    matchInfo: matchKickoffTime,
  });

  const payload = {
    type:           'poll_created',
    messageId:      msg.key.id,
    group:          groupName,
    sender,
    pollName,
    options,
    matchTimestamp: matchKickoffTime.matchTimestamp,
    timestamp:      timestamp.toISOString(),
  };
  try {
    await sendMessage(config.pollTopicName, msg.key.id!, payload);
    logger.info(`[poll] Created: "${poll.name}" [${options.join(' | ')}]`);
  } catch (err) {
    logger.info(`Error routing poll creation: ${(err as Error).message}`);
  }
}

/**
 * Maps the SHA-256 option hashes from a decrypted poll vote back to their
 * human-readable option names. Hashes that cannot be matched are silently dropped.
 * @param decryptedVote - Result of `decryptPollVote()`
 * @param options       - Original poll option names
 * @returns Selected option names
 */
function resolveSelectedOptions(
  decryptedVote: { selectedOptions?: Uint8Array[] },
  options: string[],
): string[] {
  const optionHashMap = Object.fromEntries(
    options.map((name) => [
      createHash('sha256').update(Buffer.from(name)).digest().toString(),
      name,
    ]),
  );
  return (decryptedVote.selectedOptions ?? [])
    .map((hash) => optionHashMap[Buffer.from(hash).toString()] ?? null)
    .filter((name): name is string => name !== null);
}

/**
 * Handles poll vote (update) messages. Looks up the original poll in
 * `pollKeyCache`, decrypts the vote using the stored encryption key, and
 * publishes a `poll_vote` event to the Kafka poll topic.
 *
 * If the poll is not cached (e.g. created before this service ran) the vote is
 * still published but `selectedOptions` will be empty and `pollName` will be blank.
 * @param msg     - Baileys message object
 * @param context - Resolved group name, sender JID, and timestamp
 */
export async function handlePollVote(msg: WAMessage, { groupName, sender, timestamp }: MessageContext): Promise<void> {
  const vote      = msg.message!.pollUpdateMessage!;
  const pollMsgId = vote.pollCreationMessageKey?.id ?? '';
  const cached    = await pollKeyCache.get(pollMsgId);

  let selectedOptions: string[] = [];
  if (cached?.encKey) {
    try {
      const decrypted = decryptPollVote(vote.vote!, {
        pollEncKey:     cached.encKey,
        pollCreatorJid: cached.creatorJid,
        pollMsgId,
        voterJid:       sender,
      });
      selectedOptions = resolveSelectedOptions(decrypted, cached.options);
    } catch (err) {
      logger.error(`[poll] Could not decrypt vote on poll ${pollMsgId}:  ${(err as Error).message}`);
    }
  }

  const payload = {
    type:            'poll_vote',
    messageId:       msg.key.id,
    pollMessageId:   pollMsgId,
    pollName:        cached?.pollName ?? '',
    group:           groupName,
    voter:           sender,
    voterName:       msg.pushName ?? sender,
    selectedOptions,
    timestamp:       timestamp.toISOString(),
  };
  try {
    await sendMessage(config.pollTopicName, msg.key.id!, payload);
    logger.info(`[poll] Vote from ${sender} on poll ${pollMsgId}: [${selectedOptions.join(', ')}]`);
  } catch (err) {
    logger.error(`Error routing poll vote: ${(err as Error).message}`);
  }
}
