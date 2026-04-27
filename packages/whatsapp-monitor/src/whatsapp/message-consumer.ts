
import {
    type WAMessage,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { config } from '../config.js';
import { sendMessage } from '../kafka/producer.js';
import {MessageContext} from "./client.js";

const logger = pino({ level: config.logLevel });

// ── Message type handlers ──────────────────────────────────────────────────

/**
 * Handles plain-text messages that begin with "score". Publishes a score event
 * to the configured Kafka score topic and ignores all other text messages.
 * @param msg     - Baileys message object
 * @param context - Resolved group name, sender JID, and timestamp
 */
export async function handleScoreMessage(msg: WAMessage, { groupName, sender, timestamp }: MessageContext): Promise<void> {
    const content = msg.message!;
    const text = content.conversation || content.extendedTextMessage?.text || '';
    logger.info(`text was: ${text}`);
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
        logger.info(`[score] "${text}" from ${sender}`);
    } catch (err) {
        logger.error(`Error routing score message: ${(err as Error).message}`);
    }
}