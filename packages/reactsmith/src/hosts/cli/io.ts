import { createInterface } from 'node:readline/promises';

/** How the CLI talks to the user. Replaced by a fake in tests. */
export interface CommandIO {
  log(text: string): void;
  error(text: string): void;
  /** Asks a yes/no question. Undefined when prompting is not possible (CI, agents, --json). */
  confirm?: (question: string) => Promise<boolean>;
}

/** Yes/no question on stderr, so --json output on stdout stays clean. Defaults to yes. */
async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(`${question} (Y/n) `)).trim().toLowerCase();
    return answer === '' || answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

export function terminalIO(json: boolean): CommandIO {
  return {
    log: (text) => console.log(text),
    error: (text) => console.error(text),
    confirm: !json && process.stdin.isTTY === true ? confirm : undefined,
  };
}
