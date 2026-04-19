import { Kafka, Partitioners } from 'kafkajs';
import { config } from '../config.js';

const kafka = new Kafka({
  clientId: 'whatsapp-message-monitor',
  brokers:  config.kafkaBrokers,
  retry: {
    retries:          10,
    initialRetryTime: 2000,
  },
});

const producer = kafka.producer({
  createPartitioner: Partitioners.LegacyPartitioner,
});

let connected = false;

/** Connects the KafkaJS producer. Must be called before `sendMessage`. */
export async function connectProducer() {
  await producer.connect();
  connected = true;
  console.log('Kafka producer connected.');
}

/**
 * Publishes a single message to a Kafka topic.
 * @param {string} topic - Target Kafka topic name.
 * @param {string} key   - Message key (used for partition routing).
 * @param {object} value - Message payload; serialised to JSON.
 */
export async function sendMessage(topic, key, value) {
  if (!connected) throw new Error('Kafka producer not connected');
  await producer.send({
    topic,
    messages: [{ key: String(key), value: JSON.stringify(value) }],
  });
}

/** Disconnects the KafkaJS producer if currently connected. */
export async function disconnectProducer() {
  if (connected) {
    await producer.disconnect();
    connected = false;
  }
}