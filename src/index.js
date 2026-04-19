import { config } from './config.js';
import { connectProducer, disconnectProducer } from './kafka/producer.js';
import { startWhatsAppClient, stopWhatsAppClient } from './whatsapp/client.js';

console.log('Starting WhatsApp Message Monitor...');
console.log(`  Monitoring group : ${config.groupName}`);
console.log(`  Kafka brokers    : ${config.kafkaBrokers.join(', ')}`);
console.log(`  Score topic      : ${config.scoreTopicName}`);
console.log(`  Poll topic       : ${config.pollTopicName}`);
console.log(`  Auth directory   : ${config.authDir}`);

/** Connects the Kafka producer then starts the WhatsApp client. */
async function main() {
  await connectProducer();
  await startWhatsAppClient();
}

/**
 * Gracefully shuts down all connections (WhatsApp socket + Kafka producer)
 * before exiting. Registered as the handler for SIGTERM and SIGINT.
 */
async function shutdown() {
  console.log('\nShutting down gracefully...');
  try {
    await stopWhatsAppClient();
    await disconnectProducer();
    await closePool();
  } catch (err) {
    console.error('Error during shutdown:', err.message);
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
