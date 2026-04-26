import pg from 'pg';
import { PollEvent, PollCreatedEvent, PollVoteEvent } from '../types/events.js';
import { saveMatch, findMatchByPollMessageId } from '../db/matchRepository.js';
import { findOrCreateMember } from '../db/memberRepository.js';
import { saveMatchVote } from '../db/matchVoteRepository.js';

/** Routes a poll event to the correct handler based on its type. */
export const handlePollEvent = async (
  pool: pg.Pool,
  event: PollEvent,
): Promise<void> => {
  switch (event.type) {
    case 'poll_created':
      await handlePollCreated(pool, event);
      break;
    case 'poll_vote':
      await handlePollVote(pool, event);
      break;
    default:
      console.warn(`Unknown event type: ${(event as PollEvent).type}`);
  }
};

/** Handles a poll_created event by saving it as a match. */
const handlePollCreated = async (
  pool: pg.Pool,
  event: PollCreatedEvent,
): Promise<void> => {
  const match = await saveMatch(
    pool,
    event.messageId,
    event.group,
    event.sender,
    event.pollName,
    event.matchDate,
    event.options,
    event.timestamp,
  );
  console.log(`[poll_created] Match #${match.id} "${event.pollName}" saved.`);
};

/** Handles a poll_vote event by finding/creating the member and saving the vote. */
const handlePollVote = async (
  pool: pg.Pool,
  event: PollVoteEvent,
): Promise<void> => {
  const match = await findMatchByPollMessageId(pool, event.pollMessageId);
  if (!match) {
    console.warn(`[poll_vote] No match found for poll ${event.pollMessageId}, skipping.`);
    return;
  }

  const member = await findOrCreateMember(pool, event.voter, event.voterName);
  await saveMatchVote(pool, match.id, member.id, event.selectedOptions, event.timestamp);
  console.log(`[poll_vote] ${member.name} voted [${event.selectedOptions.join(', ')}] on match #${match.id}`);
};
