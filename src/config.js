import 'dotenv/config';

export const config = {
  // WhatsApp
  groupName: process.env.WHATSAPP_GROUP_NAME || 'test-group',
  authDir:   process.env.AUTH_DIR   || './auth_info',
  cacheDir:  process.env.CACHE_DIR  || './cache',

  // Kafka
  kafkaBrokers:   (process.env.KAFKA_BROKERS || 'localhost:31092').split(','),
  scoreTopicName: process.env.KAFKA_SCORE_TOPIC || 'score',
  pollTopicName:  process.env.KAFKA_POLL_TOPIC  || 'poll',

  // PostgreSQL
  postgres: {
    host:     process.env.POSTGRES_HOST     || 'localhost',
    port:     parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB       || 'whatsapp_monitor',
    user:     process.env.POSTGRES_USER     || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
  },
};
