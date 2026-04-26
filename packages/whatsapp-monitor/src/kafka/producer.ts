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
export async function connectProducer(): Promise<void> {
  await producer.connect();
  connected = true;
  console.log('Kafka producer connected.');
}

/**
 * Publishes a single message to a Kafka topic, partitioned by group name.
 * @param topic     - Target Kafka topic name.
 * @param groupName - WhatsApp group name used as the partition key.
 * @param value     - Message payload; serialised to JSON.
 */
export async function sendMessage(topic: string, key: string, value: unknown): Promise<void> {
  if (!connected) throw new Error('Kafka producer not connected');
  await producer.send({
    topic,
    messages: [{ key: String(key), value: JSON.stringify(value) }],
  });
}

/** Disconnects the KafkaJS producer if currently connected. */
export async function disconnectProducer(): Promise<void> {
  if (connected) {
    await producer.disconnect();
    connected = false;
  }
}
