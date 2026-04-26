import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePollEvent } from '../handlers/pollEventHandler.js';
import * as matchRepo from '../db/matchRepository.js';
import * as memberRepo from '../db/memberRepository.js';
import * as voteRepo from '../db/matchVoteRepository.js';
import { PollCreatedEvent, PollVoteEvent } from '../types/events.js';

vi.mock('../db/matchRepository.js');
vi.mock('../db/memberRepository.js');
vi.mock('../db/matchVoteRepository.js');

const mockPool = {} as any;

describe('pollEventHandler', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('poll_created events', () => {
    const event: PollCreatedEvent = {
      type: 'poll_created',
      messageId: 'MSG001',
      group: 'test-group',
      sender: 'creator@lid',
      pollName: 'Saturday game',
      matchDate: '2026-04-25T15:00:00Z',
      options: ['Yes', 'No'],
      timestamp: '2026-04-24T21:00:00Z',
    };

    it('saves the match via matchRepository', async () => {
      vi.mocked(matchRepo.saveMatch).mockResolvedValue({
        id: 1, pollMessageId: 'MSG001', groupName: 'test-group',
        creator: 'creator@lid', pollName: 'Saturday game',
        matchDate: new Date('2026-04-25T15:00:00Z'),
        options: ['Yes', 'No'], createdAt: new Date('2026-04-24T21:00:00Z'),
      });

      await handlePollEvent(mockPool, event);

      expect(matchRepo.saveMatch).toHaveBeenCalledWith(
        mockPool, 'MSG001', 'test-group', 'creator@lid',
        'Saturday game', '2026-04-25T15:00:00Z', ['Yes', 'No'],
        '2026-04-24T21:00:00Z',
      );
    });
  });

  describe('poll_vote events', () => {
    const event: PollVoteEvent = {
      type: 'poll_vote',
      messageId: 'MSG002',
      pollMessageId: 'MSG001',
      pollName: 'Saturday game',
      group: 'test-group',
      voter: 'player@lid',
      voterName: 'Peter',
      selectedOptions: ['Yes'],
      timestamp: '2026-04-24T21:14:00Z',
    };

    it('finds the match, finds or creates the member, and saves the vote', async () => {
      vi.mocked(matchRepo.findMatchByPollMessageId).mockResolvedValue({
        id: 1, pollMessageId: 'MSG001', groupName: 'test-group',
        creator: 'creator@lid', pollName: 'Saturday game',
        matchDate: new Date('2026-04-25T15:00:00Z'),
        options: ['Yes', 'No'], createdAt: new Date('2026-04-24T21:00:00Z'),
      });
      vi.mocked(memberRepo.findOrCreateMember).mockResolvedValue({
        id: 5, whatsappId: 'player@lid', name: 'Peter',
        createdAt: new Date('2026-04-24T21:14:00Z'),
      });
      vi.mocked(voteRepo.saveMatchVote).mockResolvedValue({
        id: 1, matchId: 1, memberId: 5,
        selectedOptions: ['Yes'], votedAt: new Date('2026-04-24T21:14:00Z'),
      });

      await handlePollEvent(mockPool, event);

      expect(matchRepo.findMatchByPollMessageId).toHaveBeenCalledWith(mockPool, 'MSG001');
      expect(memberRepo.findOrCreateMember).toHaveBeenCalledWith(mockPool, 'player@lid', 'Peter');
      expect(voteRepo.saveMatchVote).toHaveBeenCalledWith(mockPool, 1, 5, ['Yes'], '2026-04-24T21:14:00Z');
    });

    it('skips the vote when no matching match is found', async () => {
      vi.mocked(matchRepo.findMatchByPollMessageId).mockResolvedValue(null);

      await handlePollEvent(mockPool, event);

      expect(memberRepo.findOrCreateMember).not.toHaveBeenCalled();
      expect(voteRepo.saveMatchVote).not.toHaveBeenCalled();
    });
  });
});
