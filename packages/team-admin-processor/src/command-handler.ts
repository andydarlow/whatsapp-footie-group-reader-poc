/**
 * Routes an incoming command to the appropriate handler and returns the result.
 * Add new command handlers here as the system grows.
 * @param command - The command name (e.g. 'pick_teams', 'list_players')
 * @param payload - Command-specific data
 * @returns Result object to be published on the result topic
 */
export async function processCommand(
  command: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (command) {
    case 'pick_teams':
      return handlePickTeams(payload);
    case 'list_players':
      return handleListPlayers(payload);
    default:
      return { status: 'error', message: `Unknown command: ${command}` };
  }
}

/** Placeholder: picks teams from available players. */
async function handlePickTeams(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  // TODO: implement team selection logic using poll data from the database
  return { status: 'ok', command: 'pick_teams', message: 'Not yet implemented', payload };
}

/** Placeholder: lists players who responded to a poll. */
async function handleListPlayers(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  // TODO: query poll_votes from the database for the given poll
  return { status: 'ok', command: 'list_players', message: 'Not yet implemented', payload };
}
