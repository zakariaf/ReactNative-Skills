// src/features/tasks/task-tally.ts: counts completed tasks for one list; reset() sets the total.
export class TaskTally {
  // A definite-assignment assertion, not a non-null assertion: reset() assigns it before any read.
  private total!: number;

  public constructor() {
    this.reset();
  }

  public reset(): void {
    this.total = 0;
  }

  public add(done: number): number {
    this.total += done;
    return this.total;
  }
}
