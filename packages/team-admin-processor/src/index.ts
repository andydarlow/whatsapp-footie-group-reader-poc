import { config } from './config.js';
import { startProcessor, stopProcessor } from './kafka/consumer.js';

console.log('Starting Team Admin Processor...');
console.log(`  Kafka brokers : ${config.kafka.brokers.join(', ')}`);
console.log(`  Action topic  : ${config.kafka.actionTopic}`);
console.log(`  Result topic  : ${config.kafka.resultTopic}`);

/** Starts the command processor. */
async function main(): Promise<void> {
  await startProcessor();
}

/** Gracefully shuts down the processor. */
async function shutdown(): Promise<void> {
  console.log('\nShutting down gracefully...');
  try {
    await stopProcessor();
  } catch (err) {
    console.error('Error during shutdown:', (err as Error).message);
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);

main().catch((err: Error) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
