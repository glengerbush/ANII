export type MemoryMode = 'immediate' | 'idle' | 'loaded' | 'existing';
export type DurationUnit = 's' | 'm' | 'h';
export const durationUnits = { s: 1, m: 60, h: 3600 } as const;
// Ollama durations use signed 64-bit nanoseconds. Stay within that range.
export const maxDurationSeconds = 9_223_372_036;

export function modelMemory(value: string): { mode: MemoryMode; amount: number; unit: DurationUnit } {
  const fallback = { mode: 'existing' as const, amount: 5, unit: 'm' as const };
  const raw = value.trim();
  const parts = [...raw.matchAll(/(\d+(?:\.\d+)?)(ns|us|µs|μs|ms|s|m|h)/g)];
  const units: Record<string, number> = { ns: 1e-9, us: 1e-6, µs: 1e-6, μs: 1e-6, ms: .001, ...durationUnits };
  const unsigned = raw.replace(/^[+-]/, '');
  const seconds = /^[+-]?\d+(?:\.\d+)?$/.test(raw) ? Number(raw)
    : parts.length && parts.map(part => part[0]).join('') === unsigned
      ? parts.reduce((sum, part) => sum + Number(part[1]) * units[part[2]], 0) * (raw.startsWith('-') ? -1 : 1)
      : NaN;
  if (!Number.isFinite(seconds)) return fallback;
  if (seconds <= 0) return { ...fallback, mode: seconds < 0 ? 'loaded' : 'immediate' };
  if (!Number.isSafeInteger(seconds) || seconds > maxDurationSeconds) return fallback;
  for (const unit of ['h', 'm', 's'] as const) {
    if (seconds % durationUnits[unit] === 0) return { mode: 'idle', amount: seconds / durationUnits[unit], unit };
  }
  return fallback;
}

export function memoryPreference(form: FormData, existing: string): string {
  switch (form.get('memoryMode')) {
    case 'immediate': return '0';
    case 'loaded': return '-1m';
    case 'existing': return existing;
    case 'idle': {
      const raw = String(form.get('memoryAmount') ?? '').trim();
      const unit = String(form.get('memoryUnit') ?? '');
      if (!Object.hasOwn(durationUnits, unit)) throw new Error('Choose seconds, minutes, or hours for model memory.');
      const amount = Number(raw);
      const max = Math.floor(maxDurationSeconds / durationUnits[unit as DurationUnit]);
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(amount) || amount < 1 || amount > max) {
        throw new Error(`Enter a whole number from 1 to ${max} for the model idle time.`);
      }
      return `${amount}${unit}`;
    }
    default: throw new Error('Choose when to unload the model.');
  }
}
