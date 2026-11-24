import "server-only";

import { getDb } from "../db";
import { deliverDuePush, msUntilNextPush } from "./delivery";

/** The longest the dispatcher sleeps, so notifications queued by another instance still go out. */
const MAX_SLEEP_MS = 60_000;

/**
 * In-process loop that empties the push outbox: wakes when poked (a run just
 * ended), when the next retry is due, and at least once a minute.
 */
class PushDispatcher {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private again = false;
  started = false;

  start() {
    this.started = true;
    if (!this.timer && !this.running) this.wake(0);
  }

  poke() {
    if (!this.started) return;
    if (this.running) this.again = true;
    else this.wake(0);
  }

  private wake(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref?.();
  }

  private async tick() {
    this.timer = undefined;
    this.running = true;
    let delay = MAX_SLEEP_MS;
    try {
      const db = await getDb();
      const results = await deliverDuePush(db);
      const sent = results.filter((result) => result.result === "delivered").length;
      if (sent > 0) console.log(`[push] Delivered ${sent} notification${sent === 1 ? "" : "s"}.`);
      const until = await msUntilNextPush(db);
      if (until != null) delay = Math.min(MAX_SLEEP_MS, Math.max(0, until) + 250);
    } catch (error) {
      console.error("[push] Dispatcher tick failed:", error);
    } finally {
      this.running = false;
      const again = this.again;
      this.again = false;
      this.wake(again ? 0 : delay);
    }
  }
}

const globalForPush = globalThis as unknown as { taskPanelPushDispatcher?: PushDispatcher };

function dispatcher(): PushDispatcher {
  globalForPush.taskPanelPushDispatcher ??= new PushDispatcher();
  return globalForPush.taskPanelPushDispatcher;
}

/** Starts sending queued notifications; runs whether or not the agent is on. */
export function startPushDispatcher(): void {
  dispatcher().start();
}

/** Sends what was just queued right away instead of within the minute. No-op before start. */
export function pokePushDispatcher(): void {
  dispatcher().poke();
}
