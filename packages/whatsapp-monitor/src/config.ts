import 'dotenv/config';

export const config = {
  // WhatsApp
  groupName: process.env.WHATSAPP_GROUP_NAME || 'Poly Strollers/Vets Football',
  authDir:   process.env.AUTH_DIR   || './auth_info',
  cacheDir:  process.env.CACHE_DIR  || './cache',

  // Kafka
  kafkaBrokers:   (process.env.KAFKA_BROKERS || 'localhost:31092').split(','),
  scoreTopicName: process.env.KAFKA_SCORE_TOPIC || 'score',
  pollTopicName:  process.env.KAFKA_POLL_TOPIC  || 'poll',

};
