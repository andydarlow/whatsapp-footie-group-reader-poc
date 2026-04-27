import pino from 'pino';
import { config } from './config.js';
import { connectProducer, disconnectProducer } from './kafka/producer.js';
import { startWhatsAppClient, stopWhatsAppClient } from './whatsapp/client.js';

const logger = pino({ level: config.logLevel });

logger.info('Starting WhatsApp Message Monitor...');
logger.info(`  Monitoring group : ${config.groupName}`);
logger.info(`  Kafka brokers    : ${config.kafkaBrokers.join(', ')}`);
logger.info(`  Score topic      : ${config.scoreTopicName}`);
logger.info(`  Poll topic       : ${config.pollTopicName}`);
logger.info(`  Auth directory   : ${config.authDir}`);

/** Connects the Kafka producer then starts the WhatsApp client. */
async function main(): Promise<void> {
  await connectProducer();
  await startWhatsAppClient();
}

/**
 * Gracefully shuts down all connections (WhatsApp socket + Kafka producer)
 * before exiting. Registered as the handler for SIGTERM and SIGINT.
 */
async function shutdown(): Promise<void> {
  logger.info('Shutting down gracefully...');
  try {
    await stopWhatsAppClient();
    await disconnectProducer();
  } catch (err) {
    logger.error(`Error during shutdown: ${(err as Error).message}`);
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

main().catch((err: Error) => {
  logger.error({ err }, 'Fatal error');
  process.exit(1);
});
