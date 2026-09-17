// One-action kill switch.
//
// Two properties make it worth having:
//
//   * **Persisted.** It is read from storage at the top of every cycle, not held
//     in memory. A kill switch that forgets it was pulled when the process
//     restarts is not a kill switch, and a restart is exactly what tends to
//     happen next during an incident.
//
//   * **It stops new risk, not exits.** Engaged means no new positions. Closing
//     an existing position is still permitted, because the operator pulling this
//     usually wants OUT, and a switch that freezes them into a position does the
//     opposite of what it appears to promise.
//
// Engaging takes one call and no arguments beyond a reason. There is deliberately
// no "engage with conditions", no timeout, and no automatic release.

export type KillSwitchState = {
  engaged: boolean;
  reason: string | null;
  /** When it was last engaged or released. */
  at: string | null;
  /** Who or what pulled it — "operator", or the subsystem that tripped it. */
  by: string | null;
};

export const RELEASED: KillSwitchState = { engaged: false, reason: null, at: null, by: null };

export type KillSwitchStore = {
  read(): Promise<KillSwitchState>;
  write(state: KillSwitchState): Promise<void>;
};

export function createInMemoryKillSwitch(initial: KillSwitchState = RELEASED): KillSwitchStore {
  let state = { ...initial };
  return {
    async read() {
      return { ...state };
    },
    async write(next) {
      state = { ...next };
    },
  };
}

export async function engage(
  store: KillSwitchStore,
  reason: string,
  by: string,
  now: string,
): Promise<KillSwitchState> {
  const state: KillSwitchState = { engaged: true, reason, at: now, by };
  await store.write(state);
  return state;
}

/**
 * Release the switch. Deliberately requires an explicit operator identity: an
 * automated release defeats the purpose, so nothing in the trading loop calls
 * this.
 */
export async function release(store: KillSwitchStore, by: string, now: string): Promise<KillSwitchState> {
  const state: KillSwitchState = { engaged: false, reason: null, at: now, by };
  await store.write(state);
  return state;
}
