// Pure level lookup — no DB access. A student's level is derived from total
// XP at read time, never stored as mutable state that could drift from the
// XpEvent ledger it's computed from.

export type LevelDef = { id: string; name: string; xpThreshold: number };

export function levelForXp<T extends LevelDef>(xp: number, levels: T[]): T | null {
  const eligible = levels.filter((l) => l.xpThreshold <= xp);
  if (eligible.length === 0) return null;
  return eligible.reduce((highest, l) => (l.xpThreshold > highest.xpThreshold ? l : highest));
}

export function xpToNextLevel<T extends LevelDef>(xp: number, levels: T[]): { next: T; remaining: number } | null {
  const upcoming = levels.filter((l) => l.xpThreshold > xp).sort((a, b) => a.xpThreshold - b.xpThreshold)[0];
  if (!upcoming) return null;
  return { next: upcoming, remaining: upcoming.xpThreshold - xp };
}
