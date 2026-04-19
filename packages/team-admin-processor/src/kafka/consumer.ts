import { Kafka, Partitioners } from 'kafkajs';
import { config } from '../config.js';
import { processCommand } from '../command-handler.js';

const kafka = new Kafka({
  clientId: 'team-admin-processor',
  brokers:  config.kafka.brokers,
  retry: {
    retries:          10,
    initialRetryTime: 2000,
  },
});

const consumer = kafka.consumer({ groupId: config.kafka.groupId });
const producer = kafka.producer({
  createPartitioner: Partitioners.LegacyPartitioner,
});

interface ActionEvent {
  commandId: string;
  command:   string;
  payload:   Record<string, unknown>;
  timestamp: string;
}

/** Publishes a result message to the result topic. */
async function publishResult(commandId: string, result: Record<string, unknown>): Promise<void> {
  await producer.send({
    topic: config.kafka.resultTopic,
    messages: [{
      key: commandId,
      value: JSON.stringify({
        commandId,
        ...result,
        processedAt: new Date().toISOString(),
      }),
    }],
  });
}

/** Connects and starts consuming from the action topic. */
export async function startProcessor(): Promise<void> {
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: config.kafka.actionTopic, fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;
      try {
        const event = JSON.parse(message.value.toString()) as ActionEvent;
        console.log(`[action] Processing command: ${event.command} (${event.commandId})`);

        const result = await processCommand(event.command, event.payload);
        await publishResult(event.commandId, result);

        console.log(`[result] Command ${event.commandId} completed.`);
      } catch (err) {
        console.error('Error processing action:', (err as Error).message);
      }
    },
  });

  console.log(`Consuming from topic: ${config.kafka.actionTopic}`);
  console.log(`Publishing results to: ${config.kafka.resultTopic}`);
}

/** Disconnects both consumer and producer. */
export async function stopProcessor(): Promise<void> {
  await consumer.disconnect();
  await producer.disconnect();
}
