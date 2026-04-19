import 'dotenv/config';

export const config = {
  kafka: {
    brokers:     (process.env.KAFKA_BROKERS || 'localhost:31092').split(','),
    actionTopic: process.env.KAFKA_ACTION_TOPIC || 'action',
    resultTopic: process.env.KAFKA_RESULT_TOPIC || 'result',
    groupId:     process.env.KAFKA_CONSUMER_GROUP || 'team-admin-processor',
  },
  postgres: {
    host:     process.env.POSTGRES_HOST     || 'localhost',
    port:     parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB       || 'whatsapp_monitor',
    user:     process.env.POSTGRES_USER     || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
  },
};
