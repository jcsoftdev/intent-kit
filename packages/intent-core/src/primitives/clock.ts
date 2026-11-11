import type { Clock } from '../contracts/index.js';

export type ManualClock = Clock & {
  advance(ms: number): Promise<void>;
  pending(): number;
};

const waitForDelay = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });

export const systemClock: Clock = {
  now: () => Date.now(),
  timeout: (ms) => AbortSignal.timeout(ms),
  delay: (ms, options) => waitForDelay(ms, options.signal),
};

interface ManualTimer {
  readonly deadline: number;
  readonly sequence: number;
  readonly fire: () => void;
}

const yieldMacrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const timeoutReason = (ms: number): DOMException =>
  new DOMException(`The operation timed out after ${ms}ms`, 'TimeoutError');

export const createManualClock = (start = 0): ManualClock => {
  let current = start;
  let sequence = 0;
  let timers: ManualTimer[] = [];

  const schedule = (ms: number, fire: () => void): ManualTimer => {
    sequence += 1;
    const timer = { deadline: current + ms, sequence, fire };
    timers.push(timer);
    return timer;
  };

  const cancel = (timer: ManualTimer): void => {
    timers = timers.filter((candidate) => candidate !== timer);
  };

  const nextDue = (target: number): ManualTimer | undefined =>
    timers
      .filter((timer) => timer.deadline <= target)
      .sort((a, b) => a.deadline - b.deadline || a.sequence - b.sequence)[0];

  return {
    now: () => current,
    timeout(ms) {
      const controller = new AbortController();
      schedule(ms, () => controller.abort(timeoutReason(ms)));
      return controller.signal;
    },
    delay(ms, options) {
      const { signal } = options;
      return new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        const onAbort = (): void => {
          cancel(timer);
          reject(signal.reason);
        };
        const timer = schedule(ms, () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        });
        signal.addEventListener('abort', onAbort, { once: true });
      });
    },
    async advance(ms) {
      const target = current + ms;
      for (let due = nextDue(target); due; due = nextDue(target)) {
        cancel(due);
        current = due.deadline;
        due.fire();
        await yieldMacrotask();
      }
      current = target;
    },
    pending: () => timers.length,
  };
};
