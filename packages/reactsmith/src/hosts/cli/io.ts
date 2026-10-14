import { createInterface } from 'node:readline/promises';

/** How the CLI talks to the user. Replaced by a fake in tests. */
export interface CommandIO {
  log(text: string): void;
  error(text: string): void;
  /** Asks a yes/no question. Undefined when prompting is not possible (CI, agents, --json). */
  confirm?: (question: string) => Promise<boolean>;
  /** Asks for a text answer. Undefined like `confirm`. */
  ask?: (question: string, defaultValue: string) => Promise<string>;
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

/** Text question on stderr. An empty answer gives the default. */
async function ask(question: string, defaultValue: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(`${question} (${defaultValue}) `)).trim();
    return answer === '' ? defaultValue : answer;
  } finally {
    rl.close();
  }
}

export function terminalIO(json: boolean): CommandIO {
  const interactive = !json && process.stdin.isTTY === true;
  return {
    log: (text) => console.log(text),
    error: (text) => console.error(text),
    confirm: interactive ? confirm : undefined,
    ask: interactive ? ask : undefined,
  };
}
