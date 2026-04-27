import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WAMessage,
  type WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { config } from '../config.js';
import qrcode from 'qrcode-terminal';
import {
  pollKeyCache,
  getPollCreationMessage,
  handlePollCreation,
  handlePollVote,
} from './poll-consumer.js';
import {handleScoreMessage} from "./message-consumer.js";

// common data needed to process all messages
export interface MessageContext {
  jid:       string;
  groupName: string;
  sender:    string;
  timestamp: Date;
}


// Suppress Baileys' internal verbose logging
const logger = pino({ level: 'silent' });

let sock: WASocket;
const groupNameCache = new Map<string, string>(); // jid -> group subject



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



// ── Event bridge ───────────────────────────────────────────────────────────

/**
 * context is used to process any meessage from Whatsapp. Create this context
 * @param msg the whatapps message
 */
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
async function handleConnectionOpen(): Promise<void> {
  console.log('WhatsApp connected.');
  await preloadGroups();
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

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr)                    handleQRCode(qr);
      if (connection === 'open') await handleConnectionOpen();
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
