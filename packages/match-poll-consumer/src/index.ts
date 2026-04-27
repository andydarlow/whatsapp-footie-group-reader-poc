import { config } from './config.js';
import { closeDatabase } from './db/client.js';
import { startConsumer, stopConsumer } from './kafka/consumer.js';

console.log('Starting Match Poll Consumer...');
console.log(`  Kafka brokers : ${config.kafka.brokers.join(', ')}`);
console.log(`  Poll topic    : ${config.kafka.pollTopic}`);
console.log(`  Consumer group: ${config.kafka.groupId}`);

/** Connects to the database and starts consuming from Kafka. */
async function main(): Promise<void> {
  await startConsumer();
}

/** Gracefully shuts down the consumer and database connections. */
async function shutdown(): Promise<void> {
  console.log('\nShutting down gracefully...');
  try {
    await stopConsumer();
    await closeDatabase();
  } catch (err) {
    console.error('Error during shutdown:', (err as Error).message);
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main().catch((err: Error) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
