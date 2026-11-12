export interface AdaptiveLimiterOptions {
  readonly floorMax: number;
  readonly ceilingMax: number;
  readonly windowMs: number;
  readonly successesBeforeRaise?: number;
  readonly raiseStep?: number;
}

/**
 * Sliding-window rate limiter with additive increase / multiplicative decrease.
 *
 * Used for outbound calls to third-party APIs whose real limits are undocumented
 * or vary by account: start at a safe floor, raise the ceiling after a run of
 * successes, and halve it on every provider rate-limit response.
 *
 * `acquire()` gates callers to stay within `currentMax` calls per `windowMs`.
 * `reportSuccess()` / `reportRateLimit()` adjust `currentMax` at runtime.
 *
 * The class does not log — call sites are responsible for observability.
 */
export class AdaptiveSlidingWindowLimiter {
  private readonly timestamps: number[] = [];
  private readonly queue: (() => void)[] = [];
  private timerRunning = false;

  private _currentMax: number;
  private readonly floorMax: number;
  private readonly ceilingMax: number;
  private readonly windowMs: number;
  private readonly successesBeforeRaise: number;
  private readonly raiseStep: number;
  private consecutiveSuccesses = 0;

  constructor(options: AdaptiveLimiterOptions) {
    this.floorMax = options.floorMax;
    this.ceilingMax = options.ceilingMax;
    this.windowMs = options.windowMs;
    this.successesBeforeRaise = options.successesBeforeRaise ?? 15;
    this.raiseStep = options.raiseStep ?? 20;
    this._currentMax = this.floorMax;
  }

  get currentMax(): number {
    return this._currentMax;
  }

  async acquire(): Promise<void> {
    this.prune();

    if (this.timestamps.length < this._currentMax) {
      this.timestamps.push(Date.now());
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.scheduleFlush();
    });
  }

  reportSuccess(): void {
    this.consecutiveSuccesses++;
    if (
      this.consecutiveSuccesses >= this.successesBeforeRaise &&
      this._currentMax < this.ceilingMax
    ) {
      this._currentMax = Math.min(this._currentMax + this.raiseStep, this.ceilingMax);
      this.consecutiveSuccesses = 0;
    }
  }

  reportRateLimit(): void {
    this._currentMax = Math.max(Math.floor(this._currentMax / 2), this.floorMax);
    this.consecutiveSuccesses = 0;
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0]! <= cutoff) {
      this.timestamps.shift();
    }
  }

  private scheduleFlush(): void {
    if (this.timerRunning || this.queue.length === 0) return;
    this.timerRunning = true;

    const waitMs =
      this.timestamps.length > 0 ? this.timestamps[0]! + this.windowMs - Date.now() + 100 : 100;

    setTimeout(
      () => {
        this.timerRunning = false;
        this.prune();

        while (this.queue.length > 0 && this.timestamps.length < this._currentMax) {
          this.timestamps.push(Date.now());
          this.queue.shift()!();
        }

        if (this.queue.length > 0) this.scheduleFlush();
      },
      Math.max(waitMs, 100),
    );
  }
}
