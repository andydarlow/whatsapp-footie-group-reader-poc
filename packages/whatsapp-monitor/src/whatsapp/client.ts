import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  decryptPollVote,
  type WAMessage,
  type WAMessageContent,
  type WASocket,
} from '@whiskeysockets/baileys';
import { createHash } from 'crypto';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { config } from '../config.js';
import { sendMessage } from '../kafka/producer.js';
import { createFileCache } from '../cache/file-cache.js';
import qrcode from 'qrcode-terminal';

// Suppress Baileys' internal verbose logging
const logger = pino({ level: 'silent' });

interface MessageContext {
  jid:       string;
  groupName: string;
  sender:    string;
  timestamp: Date;
}

interface MatchKickoffTime {
  dayOfWeek:   string;
  dateOfMonth: string;
  month:       string;
  kickoffTime: string;
  matchTimestamp: string;
}

interface PollCacheEntry {
  encKey:     Buffer | Uint8Array;
  creatorJid: string;
  pollName:   string;
  options:    string[];
  matchInfo?: MatchKickoffTime;
}

let sock: WASocket;
const groupNameCache = new Map<string, string>(); // jid -> group subject
const pollKeyCache   = createFileCache<PollCacheEntry>(config.cacheDir);

/**
 * Returns the human-readable subject for a group JID. Results are cached in
 * `groupNameCache`; on a miss the WhatsApp API is queried and the result is
 * stored. Falls back to the raw JID if metadata cannot be fetched.
 * @param jid - Group JID (e.g. `123456789@g.us`)
 */
async function resolveGroupName(jid: string): Promise<string> {
  if (groupNameCache.has(jid)) return groupNameCache.get(jid)!;
  try {
    const meta = await sock.groupMetadata(jid);
    groupNameCache.set(jid, meta.subject);
    return meta.subject;
  } catch {
    return jid;
  }
}

/**
 * Fetches all groups the WhatsApp account participates in and populates
 * `groupNameCache` (JID → subject). Logs a warning if the configured target
 * group is not among them so misconfiguration is caught early.
 */
async function preloadGroups(): Promise<void> {
  try {
    const groups = await sock.groupFetchAllParticipating();
    for (const [jid, meta] of Object.entries(groups)) {
      groupNameCache.set(jid, meta.subject);
    }
    const found = [...groupNameCache.values()].includes(config.groupName);
    if (found) {
      console.log(`Monitoring group: "${config.groupName}"`);
    } else {
      console.warn(`Warning: group "${config.groupName}" not found in joined groups.`);
      console.warn('Available groups:', [...groupNameCache.values()].join(', ') || '(none)');
    }
  } catch (err) {
    console.error('Could not preload group list:', (err as Error).message);
  }
}


async function getGroupName(msg: WAMessage): Promise<String | null > {
  const jid = msg.key.remoteJid;
  if (!jid?.endsWith('@g.us')) return null;
  return await resolveGroupName(jid);

}

/**
 * Returns `true` if the message was sent to the configured target group.
 * Rejects any message whose `remoteJid` is not a group JID (`@g.us` suffix).
 * @param msg - Baileys message object
 */
async function isTargetGroup(msg: WAMessage): Promise<boolean> {
  const name =  await getGroupName(msg)
  return name == config.groupName;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extracts the poll creation message from a message content object regardless
 * of which protobuf version was used. WhatsApp clients emit V1/V2/V3 depending
 * on their version; historical (offline-period) messages may use older variants.
 * @param content - `msg.message` from a Baileys message event
 * @returns The poll creation message, or `null` if not present.
 */
function getPollCreationMessage(content: NonNullable<WAMessage['message']>) {
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

  if (!isAm && !isPm && hours < 12 ) hours += 12; // just incase it says game at 3:00
  if (isPm && hours < 12) hours += 12;
  if (isAm && hours === 12) hours = 0;


  return { hours, minutes };
}

// ── Message type handlers ──────────────────────────────────────────────────

/**
 * Handles plain-text messages that begin with "score". Publishes a score event
 * to the configured Kafka score topic and ignores all other text messages.
 * @param msg     - Baileys message object
 * @param context - Resolved group name, sender JID, and timestamp
 */
async function handleScoreMessage(msg: WAMessage, { groupName, sender, timestamp }: MessageContext): Promise<void> {
  const content = msg.message!;
  const text = content.conversation || content.extendedTextMessage?.text || '';
  console.log(`text was: ${text}`)
  if (!text.trim().toLowerCase().startsWith('score')) return;

  const payload = {
    messageId: msg.key.id,
    group:     groupName,
    sender,
    text,
    timestamp: timestamp.toISOString(),
  };
  try {
    await sendMessage(config.scoreTopicName, msg.key.id!, payload);
    console.log(`[score] "${text}" from ${sender}`);
  } catch (err) {
    console.error('Error routing score message:', (err as Error).message);
  }
}

/**
 * Handles poll creation messages (V1/V2/V3). Caches the poll's encryption key,
 * creator JID, name, and options in `pollKeyCache` so that subsequent votes can
 * be decrypted. Publishes a `poll_created` event to the Kafka poll topic.
 * @param msg     - Baileys message object
 * @param context - Resolved group name, sender JID, and timestamp
 */
async function handlePollCreation(msg: WAMessage, { groupName, sender, timestamp }: MessageContext): Promise<void> {
  const poll    = getPollCreationMessage(msg.message!)!;
  const options = poll.options?.map((o) => o.optionName ?? '') ?? [];
  const pollName = poll.name ?? '';

  const matchKickoffTime = parseMatchInfo(pollName);
  if (!matchKickoffTime) {
    console.log(`[poll] Skipping non-match poll: "${pollName}"`);
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
    console.log(`[poll] Created: "${poll.name}" [${options.join(' | ')}]`);
  } catch (err) {
    console.error('Error routing poll creation:', (err as Error).message);
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
async function handlePollVote(msg: WAMessage, { groupName, sender, timestamp }: MessageContext): Promise<void> {
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
      console.warn(`[poll] Could not decrypt vote on poll ${pollMsgId}:`, (err as Error).message);
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
    console.log(`[poll] Vote from ${sender} on poll ${pollMsgId}: [${selectedOptions.join(', ')}]`);
  } catch (err) {
    console.error('Error routing poll vote:', (err as Error).message);
  }
}

// ── Event bridge ───────────────────────────────────────────────────────────

async function makeContext(msg: WAMessage) {
  const content = msg.message;
  const timestamp = new Date((Number(msg.messageTimestamp) || Date.now() / 1000) * 1000);
  const jid = content?.pollUpdateMessage ? content.pollUpdateMessage.pollCreationMessageKey?.remoteJid :
      msg.key.remoteJid!;
  const groupName = await resolveGroupName(jid!);
  return {
    jid: jid!,
    groupName,
    sender: msg.key.participant || msg.key.remoteJid || '',
    timestamp,
  };
}

/**
 * Central event bridge for all incoming Baileys messages. Routes each message
 * to the appropriate typed handler after applying group filtering.
 *
 * Poll votes are delivered peer-to-peer (remoteJid = voter, not group), so they
 * are identified and routed using the embedded `pollCreationMessageKey.remoteJid`.
 * All other message types use the standard `isTargetGroup` check.
 * @param msg - Baileys message object from `messages.upsert` or `messaging-history.set`
 */
async function handleMessage(msg: WAMessage): Promise<void> {
  if (!msg.message) return;

  const content   = msg.message;
  const context = await makeContext(msg);
  if (content.pollUpdateMessage && context.jid?.endsWith('@g.us')) await handlePollVote(msg, context);
  if (content.conversation || content.extendedTextMessage) await handleScoreMessage(msg, context);
  if (getPollCreationMessage(content))                      await handlePollCreation(msg, context);
}

// ── Connection event handlers ──────────────────────────────────────────────

/**
 * Renders the WhatsApp pairing QR code to the terminal so the user can
 * link this device via the WhatsApp mobile app.
 * @param qr - QR code string from the `connection.update` event
 */
function handleQRCode(qr: string): void {
  qrcode.generate(qr, { small: true });
  console.log('Scan the QR code above with WhatsApp to link this device.');
}

/**
 * Called when the WhatsApp connection is successfully established.
 * Triggers group preloading so the target group can be identified immediately.
 */
function handleConnectionOpen(): void {
  console.log('WhatsApp connected.');
  preloadGroups();
}

/**
 * Called when the WhatsApp connection drops. Schedules a reconnect after 5 s
 * unless the disconnect reason is a deliberate logout, in which case the user
 * must re-pair the device.
 * @param lastDisconnect - Baileys disconnect info (`{ error }`)
 * @param reconnect      - Callback that re-creates the socket
 */
function handleConnectionClose(lastDisconnect: { error?: Error } | undefined, reconnect: () => void): void {
  const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
  if (statusCode === DisconnectReason.loggedOut) {
    console.error('Logged out. Delete auth directory and restart to re-pair.');
  } else {
    console.log(`Connection closed (code ${statusCode}). Reconnecting in 5 s...`);
    setTimeout(reconnect, 5000);
  }
}

/**
 * Initialises and starts the WhatsApp client. Sets up the Baileys socket with
 * persisted multi-file auth state and registers event listeners for credentials,
 * connection state, historical messages, and live messages.
 *
 * Calls `pollKeyCache.init()` first to ensure the cache directory exists.
 */
export async function startWhatsAppClient(): Promise<void> {
  await pollKeyCache.init();

  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version }          = await fetchLatestBaileysVersion();

  console.log(`Baileys version: ${version.join('.')}`);

  const connect = (): void => {
    sock = makeWASocket({
      version,
      auth:                state,
      logger,
      markOnlineOnConnect: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr)                    handleQRCode(qr);
      if (connection === 'open') handleConnectionOpen();
      if (connection === 'close') handleConnectionClose(lastDisconnect as { error?: Error }, connect);
    });

    sock.ev.on('messaging-history.set', async ({ messages }) => {
      for (const msg of messages) {
        await handleMessage(msg);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        await handleMessage(msg);
      }
    });
  };

  connect();
}

/** Gracefully closes the active WhatsApp socket if one is open. */
export async function stopWhatsAppClient(): Promise<void> {
  if (sock) {
    sock.end(undefined);
  }
}
