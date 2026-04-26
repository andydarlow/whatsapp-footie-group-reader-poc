import { Kafka } from 'kafkajs';
import { config } from '../config.js';
import { getPool } from '../db/client.js';
import { handlePollEvent } from '../handlers/pollEventHandler.js';
import { PollEvent } from '../types/events.js';

const kafka = new Kafka({
  clientId: 'match-poll-consumer',
  brokers: config.kafka.brokers,
  retry: {
    retries: 10,
    initialRetryTime: 2000,
  },
});

const consumer = kafka.consumer({ groupId: config.kafka.groupId });

/** Parses a raw Kafka message buffer into a PollEvent. */
const parseMessage = (value: Buffer): PollEvent =>
  JSON.parse(value.toString()) as PollEvent;

/** Connects to Kafka and starts consuming poll events from the configured topic. */
export const startConsumer = async (): Promise<void> => {
  await consumer.connect();
  await consumer.subscribe({ topic: config.kafka.pollTopic, fromBeginning: true });

  const pool = getPool();

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;
      try {
        const event = parseMessage(message.value);
        await handlePollEvent(pool, event);
      } catch (err) {
        console.error('Error processing poll message:', (err as Error).message);
      }
    },
  });

  console.log(`Consuming from topic: ${config.kafka.pollTopic}`);
};

/** Disconnects the Kafka consumer. */
export const stopConsumer = async (): Promise<void> => {
  await consumer.disconnect();
};
