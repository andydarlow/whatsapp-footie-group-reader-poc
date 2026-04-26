/** Event emitted when a new poll is created in the WhatsApp group. */
export interface PollCreatedEvent {
  type: 'poll_created';
  messageId: string;
  group: string;
  sender: string;
  pollName: string;
  matchDate: string;
  options: string[];
  timestamp: string;
}

/** Event emitted when a member votes on a poll. */
export interface PollVoteEvent {
  type: 'poll_vote';
  messageId: string;
  pollMessageId: string;
  pollName: string;
  group: string;
  voter: string;
  voterName: string;
  selectedOptions: string[];
  timestamp: string;
}

/** Union type covering all poll-related Kafka events. */
export type PollEvent = PollCreatedEvent | PollVoteEvent;

/** A match record as stored in the database. */
export interface Match {
  id: number;
  pollMessageId: string;
  groupName: string;
  creator: string;
  pollName: string;
  matchDate: Date | null;
  options: string[];
  createdAt: Date;
}

/** A member record as stored in the database. */
export interface Member {
  id: number;
  whatsappId: string;
  name: string;
  createdAt: Date;
}

/** A match vote record as stored in the database. */
export interface MatchVote {
  id: number;
  matchId: number;
  memberId: number;
  selectedOptions: string[];
  votedAt: Date;
}
