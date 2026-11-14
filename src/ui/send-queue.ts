type Send = () => Promise<void>;

interface Queued {
  generation: number;
  send: Send;
  /** A latest-wins send: a newer one queued straight after replaces it. */
  replaceable: boolean;
  done?: () => void;
}

/**
 * One request to the worker at a time. Most sends are latest-wins (a filter
 * typed while another runs only needs the newest), but a change that must land,
 * such as each of several fixes applied in one go, waits its turn in order and
 * is never replaced. Sends queued for an earlier table are dropped.
 */
export class SendQueue {
  private busy = false;
  private readonly queue: Queued[] = [];
  /** Inside `ordered`: every send is kept and run in order. */
  private orderedDepth = 0;

  constructor(
    private readonly generation: () => number,
    private readonly afterEach: () => void = () => undefined,
  ) {}

  /** Runs now when idle; otherwise replaces a latest-wins send waiting at the back. */
  latest(send: Send): void {
    if (this.orderedDepth > 0) {
      void this.inOrder(send);
      return;
    }
    if (!this.busy) {
      this.run({ generation: this.generation(), send, replaceable: true });
      return;
    }
    const tail = this.queue[this.queue.length - 1];
    if (tail !== undefined && tail.replaceable) {
      tail.send = send;
      tail.generation = this.generation();
      return;
    }
    this.queue.push({ generation: this.generation(), send, replaceable: true });
  }

  /** Runs after everything queued before it and is never replaced; resolves once it has run (or was dropped with its table). */
  inOrder(send: Send): Promise<void> {
    return new Promise((resolve) => {
      const item: Queued = { generation: this.generation(), send, replaceable: false, done: resolve };
      if (this.busy) this.queue.push(item);
      else this.run(item);
    });
  }

  /**
   * Runs an action that makes several changes at once (Undo all, undoing a
   * batch): every send it makes is kept and runs in order, none replaced.
   */
  ordered(run: () => void): void {
    this.orderedDepth++;
    try {
      run();
    } finally {
      this.orderedDepth--;
    }
  }

  /** Forgets everything waiting (a new table is loading). */
  clear(): void {
    for (const item of this.queue.splice(0)) item.done?.();
  }

  private run(item: Queued): void {
    this.busy = true;
    void item.send().finally(() => {
      item.done?.();
      this.busy = false;
      this.afterEach();
      while (this.queue.length > 0) {
        const next = this.queue.shift() as Queued;
        if (next.generation === this.generation()) {
          this.run(next);
          return;
        }
        next.done?.();
      }
    });
  }
}
