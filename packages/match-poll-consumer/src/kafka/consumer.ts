import { Kafka } from 'kafkajs';
import { config } from '../config.js';
import { savePoll, saveVote } from '../db/client.js';

const kafka = new Kafka({
  clientId: 'match-poll-consumer',
  brokers:  config.kafka.brokers,
  retry: {
    retries:          10,
    initialRetryTime: 2000,
  },
});

const consumer = kafka.consumer({ groupId: config.kafka.groupId });

interface PollCreatedEvent {
  type:      'poll_created';
  messageId: string;
  group:     string;
  sender:    string;
  pollName:  string;
  options:   string[];
  timestamp: string;
}

interface PollVoteEvent {
  type:            'poll_vote';
  messageId:       string;
  pollMessageId:   string;
  pollName:        string;
  group:           string;
  voter:           string;
  voterName:       string;
  selectedOptions: string[];
  timestamp:       string;
}

type PollEvent = PollCreatedEvent | PollVoteEvent;

/** Handles a single poll event by routing to the correct DB operation. */
async function handlePollEvent(event: PollEvent): Promise<void> {
  if (event.type === 'poll_created') {
    await savePoll(
      event.messageId,
      event.group,
      event.sender,
      event.pollName,
      event.options,
      event.timestamp,
    );
    console.log(`[poll_created] "${event.pollName}" saved.`);
  } else if (event.type === 'poll_vote') {
    await saveVote(
      event.pollMessageId,
      event.voter,
      event.voterName,
      event.selectedOptions,
      event.timestamp,
    );
    console.log(`[poll_vote] ${event.voterName} voted [${event.selectedOptions.join(', ')}]`);
  }
}

/** Connects and starts consuming from the poll topic. */
export async function startConsumer(): Promise<void> {
  await consumer.connect();
  await consumer.subscribe({ topic: config.kafka.pollTopic, fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;
      try {
        const event = JSON.parse(message.value.toString()) as PollEvent;
        await handlePollEvent(event);
      } catch (err) {
        console.error('Error processing poll message:', (err as Error).message);
      }
    },
  });

  console.log(`Consuming from topic: ${config.kafka.pollTopic}`);
}

/** Disconnects the Kafka consumer. */
export async function stopConsumer(): Promise<void> {
  await consumer.disconnect();
}
