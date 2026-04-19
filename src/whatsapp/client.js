import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  decryptPollVote,
} from '@whiskeysockets/baileys';
import { createHash } from 'crypto';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { config } from '../config.js';
import { sendMessage } from '../kafka/producer.js';
import { createFileCache } from '../cache/file-cache.js';
import qrcode from "qrcode-terminal";

// Suppress Baileys' internal verbose logging
const logger = pino({ level: 'silent' });

let sock;
const groupNameCache = new Map(); // jid -> group subject
const pollKeyCache   = createFileCache(config.cacheDir);

/**
 * Returns the human-readable subject for a group JID. Results are cached in
 * `groupNameCache`; on a miss the WhatsApp API is queried and the result is
 * stored. Falls back to the raw JID if metadata cannot be fetched.
 * @param {string} jid - Group JID (e.g. `123456789@g.us`)
 * @returns {Promise<string>}
 */
async function resolveGroupName(jid) {
  if (groupNameCache.has(jid)) return groupNameCache.get(jid);
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
async function preloadGroups() {
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
    console.error('Could not preload group list:', err.message);
  }
}

/**
 * Returns `true` if the message was sent to the configured target group.
 * Rejects any message whose `remoteJid` is not a group JID (`@g.us` suffix).
 * @param {object} msg - Baileys message object
 * @returns {Promise<boolean>}
 */
async function isTargetGroup(msg) {
  const jid = msg.key.remoteJid;
  if (!jid?.endsWith('@g.us')) return;  // groups only
  const groupName = await resolveGroupName(jid);
  return groupName === config.groupName;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extracts the poll creation message from a message content object regardless
 * of which protobuf version was used. WhatsApp clients emit V1/V2/V3 depending
 * on their version; historical (offline-period) messages may use older variants.
 * @param {object} content - `msg.message` from a Baileys message event
 * @returns {object|null} The poll creation message, or `null` if not present.
 */
function getPollCreationMessage(content) {
  return content.pollCreationMessageV3
    ?? content.pollCreationMessageV2
    ?? content.pollCreationMessage
    ?? null;
}

// ── Message type handlers ──────────────────────────────────────────────────

/**
 * Handles plain-text messages that begin with "score". Publishes a score event
 * to the configured Kafka score topic and ignores all other text messages.
 * @param {object} msg                  - Baileys message object
 * @param {string} options.groupName    - Human-readable group name
 * @param {string} options.sender       - Sender JID
 * @param {Date}   options.timestamp    - Message timestamp
 */
async function handleScoreMessage(msg, { groupName, sender, timestamp }) {
  const content = msg.message;
  const text = content.conversation || content.extendedTextMessage?.text || '';
  if (!text.trim().toLowerCase().startsWith('score')) return;

  const payload = {
    messageId: msg.key.id,
    group:     groupName,
    sender,
    text,
    timestamp: timestamp.toISOString(),
  };
  try {
    await sendMessage(config.scoreTopicName, msg.key.id, payload);
    console.log(`[score] "${text}" from ${sender}`);
  } catch (err) {
    console.error('Error routing score message:', err.message);
  }
}

/**
 * Handles poll creation messages (V1/V2/V3). Caches the poll's encryption key,
 * creator JID, name, and options in `pollKeyCache` so that subsequent votes can
 * be decrypted. Publishes a `poll_created` event to the Kafka poll topic.
 * @param {object} msg                  - Baileys message object
 * @param {string} options.groupName    - Human-readable group name
 * @param {string} options.sender       - Creator JID
 * @param {Date}   options.timestamp    - Message timestamp
 */
async function handlePollCreation(msg, { groupName, sender, timestamp }) {
  const poll    = getPollCreationMessage(msg.message);
  const options = poll.options?.map(o => o.optionName) ?? [];

  await pollKeyCache.set(msg.key.id, {
    encKey:     msg.message.messageContextInfo?.messageSecret,
    creatorJid: sender,
    pollName:   poll.name,
    options,
  });

  const payload = {
    type:      'poll_created',
    messageId: msg.key.id,
    group:     groupName,
    sender,
    pollName:  poll.name,
    options,
    timestamp: timestamp.toISOString(),
  };
  try {
    await sendMessage(config.pollTopicName, msg.key.id, payload);
    console.log(`[poll] Created: "${poll.name}" [${options.join(' | ')}]`);
  } catch (err) {
    console.error('Error routing poll creation:', err.message);
  }
}

/**
 * Maps the SHA-256 option hashes from a decrypted poll vote back to their
 * human-readable option names. Hashes that cannot be matched are silently dropped.
 * @param {object}   decryptedVote              - Result of `decryptPollVote()`
 * @param {string[]} options                    - Original poll option names
 * @returns {string[]} Selected option names
 */
function resolveSelectedOptions(decryptedVote, options) {
  const optionHashMap = Object.fromEntries(
    options.map(name => [createHash('sha256').update(Buffer.from(name)).digest().toString(), name])
  );
  return (decryptedVote.selectedOptions ?? [])
    .map(hash => optionHashMap[Buffer.from(hash).toString()] ?? null)
    .filter(Boolean);
}

/**
 * Handles poll vote (update) messages. Looks up the original poll in
 * `pollKeyCache`, decrypts the vote using the stored encryption key, and
 * publishes a `poll_vote` event to the Kafka poll topic.
 *
 * If the poll is not cached (e.g. created before this service ran) the vote is
 * still published but `selectedOptions` will be empty and `pollName` will be blank.
 * @param {object} msg                  - Baileys message object
 * @param {string} options.groupName    - Human-readable group name
 * @param {string} options.sender       - Voter JID
 * @param {Date}   options.timestamp    - Message timestamp
 */
async function handlePollVote(msg, { groupName, sender, timestamp }) {
  const vote      = msg.message.pollUpdateMessage;
  const pollMsgId = vote.pollCreationMessageKey?.id ?? '';
  const cached    = await pollKeyCache.get(pollMsgId);

  let selectedOptions = [];
  if (cached?.encKey) {
    try {
      const decrypted = decryptPollVote(vote.vote, {
        pollEncKey:     cached.encKey,
        pollCreatorJid: cached.creatorJid,
        pollMsgId,
        voterJid:       sender,
      });
      selectedOptions = resolveSelectedOptions(decrypted, cached.options);
    } catch (err) {
      console.warn(`[poll] Could not decrypt vote on poll ${pollMsgId}:`, err.message);
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
    await sendMessage(config.pollTopicName, msg.key.id, payload);
    console.log(`[poll] Vote from ${sender} on poll ${pollMsgId}: [${selectedOptions.join(', ')}]`);
  } catch (err) {
    console.error('Error routing poll vote:', err.message);
  }
}

// ── Event bridge ───────────────────────────────────────────────────────────

/**
 * Central event bridge for all incoming Baileys messages. Routes each message
 * to the appropriate typed handler after applying group filtering.
 *
 * Poll votes are delivered peer-to-peer (remoteJid = voter, not group), so they
 * are identified and routed using the embedded `pollCreationMessageKey.remoteJid`.
 * All other message types use the standard `isTargetGroup` check.
 * @param {object} msg - Baileys message object from `messages.upsert` or `messaging-history.set`
 */
async function handleMessage(msg) {
  if (!msg.message) return;

  const content   = msg.message;
  const timestamp = new Date((Number(msg.messageTimestamp) || Date.now() / 1000) * 1000);

  // Poll votes are delivered peer-to-peer: remoteJid is the voter's JID, not the
  // group. The group JID lives on the referenced poll creation message key instead.
  if (content.pollUpdateMessage) {
    const groupJid = content.pollUpdateMessage.pollCreationMessageKey?.remoteJid;
    if (!groupJid?.endsWith('@g.us')) return;
    const groupName = await resolveGroupName(groupJid);
    if (groupName !== config.groupName) return;
    await handlePollVote(msg, {
      jid: groupJid,
      groupName,
      sender:    msg.key.participant || msg.key.remoteJid,
      timestamp,
    });
    return;
  }

  // All other message types use the standard group filter.
  if (!await isTargetGroup(msg)) return;

  const jid       = msg.key.remoteJid;
  const groupName = await resolveGroupName(jid);
  const context   = {
    jid,
    groupName,
    sender:    msg.key.participant || msg.key.remoteJid,
    timestamp,
  };

  if (content.conversation || content.extendedTextMessage) await handleScoreMessage(msg, context);
  if (getPollCreationMessage(content))                      await handlePollCreation(msg, context);
}

// ── Connection event handlers ──────────────────────────────────────────────

/**
 * Renders the WhatsApp pairing QR code to the terminal so the user can
 * link this device via the WhatsApp mobile app.
 * @param {string} qr - QR code string from the `connection.update` event
 */
function handleQRCode(qr) {
  qrcode.generate(qr, { small: true });
  console.log('Scan the QR code above with WhatsApp to link this device.');
}

/**
 * Called when the WhatsApp connection is successfully established.
 * Triggers group preloading so the target group can be identified immediately.
 */
function handleConnectionOpen() {
  console.log('WhatsApp connected.');
  preloadGroups();
}

/**
 * Called when the WhatsApp connection drops. Schedules a reconnect after 5 s
 * unless the disconnect reason is a deliberate logout, in which case the user
 * must re-pair the device.
 * @param {object}   lastDisconnect - Baileys disconnect info (`{ error }`)
 * @param {Function} reconnect      - Callback that re-creates the socket
 */
function handleConnectionClose(lastDisconnect, reconnect) {
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
export async function startWhatsAppClient() {
  await pollKeyCache.init();

  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version }          = await fetchLatestBaileysVersion();

  console.log(`Baileys version: ${version.join('.')}`);

  const connect = () => {
    sock = makeWASocket({
      version,
      auth:                 state,
      logger,
      markOnlineOnConnect:  false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (qr)                    handleQRCode(qr);
      if (connection === 'open') handleConnectionOpen();
      if (connection === 'close') handleConnectionClose(lastDisconnect, connect);
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
export async function stopWhatsAppClient() {
  if (sock) {
    await sock.end();
  }
}
