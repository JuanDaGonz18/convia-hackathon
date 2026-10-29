/**
 * Number grounding: every number the agent writes must come from data. Times ("6:40", "06:40",
 * "6:40 p. m."), prices ("$5.000", "5000", "5,000"), decimals ("0,4 km", "4.9") and plain numbers
 * are extracted from the text and compared with the numbers in the allowed values (tool outputs
 * of this run, or only the proposed trip and the spec). Pure TypeScript, unit-tested.
 */

const TIME = /(\d{1,2})\s*[:.h]\s*(\d{2})(?!\d)\s*(a\.?\s?m\.?|p\.?\s?m\.?)?/gi;
const NUMBER = /\d+(?:[.,]\d+)*/g;

type Extracted = { times: string[]; numbers: { text: string; values: number[] }[] };

const pad = (n: number) => String(n).padStart(2, '0');

/** "6:40" can be 06:40 or 18:40 when no a.m./p.m. is written; both are candidates. */
function timeCandidates(hours: number, minutes: number, meridiem: string | undefined) {
  if (hours > 23 || minutes > 59) return [];
  const m = meridiem?.toLowerCase().replace(/[\s.]/g, '');
  if (m === 'pm') return [`${pad(hours === 12 ? 12 : hours + 12)}:${pad(minutes)}`];
  if (m === 'am') return [`${pad(hours === 12 ? 0 : hours)}:${pad(minutes)}`];
  return hours <= 12 ? [`${pad(hours)}:${pad(minutes)}`, `${pad(hours === 12 ? 12 : hours + 12)}:${pad(minutes)}`] : [`${pad(hours)}:${pad(minutes)}`];
}

/** "5.000" / "5,000" → 5000 (thousands); "0,4" / "4.9" → 0.4 / 4.9 (decimals). */
function numberValues(text: string): number[] {
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(text)) {
    const thousands = Number(text.replace(/[.,]/g, ''));
    // "1.200" could also be 1.2 written with a thousands-looking decimal; keep both readings.
    return /^\d{1,3}[.,]\d{3}$/.test(text) ? [thousands, Number(text.replace(',', '.'))] : [thousands];
  }
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) ? [value] : [];
}

/** `literal24h`: data (tool outputs) writes times in 24 h, so "06:40" is only 06:40 there. */
export function extract(text: string, literal24h = false): Extracted {
  const times: string[] = [];
  const withoutTimes = text.replace(TIME, (match, h, m, meridiem) => {
    const candidates = literal24h ? (Number(h) <= 23 && Number(m) <= 59 ? [`${pad(Number(h))}:${pad(Number(m))}`] : []) : timeCandidates(Number(h), Number(m), meridiem);
    // A time like "6:40" is recorded as all its readings joined, so one reading must match.
    if (candidates.length) times.push(candidates.join('|'));
    return ' ';
  });
  const numbers = [...withoutTimes.matchAll(NUMBER)].map(([match]) => ({ text: match, values: numberValues(match) }));
  return { times, numbers };
}

/** Every number and time found in the values (numbers as is; strings scanned). */
export function allowedFrom(values: unknown[]) {
  const numbers = new Set<number>();
  const times = new Set<string>();
  const add = (value: number) => {
    numbers.add(value);
    numbers.add(Math.round(value * 10) / 10);
    numbers.add(Math.round(value));
    // Kilometres are often said in metres ("400 m"): allow the rounded metres too.
    if (value > 0 && value < 50 && !Number.isInteger(value)) {
      numbers.add(Math.round(value * 1000));
      numbers.add(Math.round(value * 10) * 100);
    }
  };
  const visit = (value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) add(Math.abs(value));
    else if (typeof value === 'string') {
      const found = extract(value, true);
      for (const time of found.times) for (const candidate of time.split('|')) times.add(candidate);
      for (const number of found.numbers) for (const v of number.values) add(v);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  values.forEach(visit);
  return { numbers, times };
}

/** The numbers and times in `text` that none of the allowed values contain (empty = grounded). */
export function ungrounded(text: string, allowed: ReturnType<typeof allowedFrom>) {
  const found = extract(text);
  const missing: string[] = [];
  for (const time of found.times) {
    const candidates = time.split('|');
    if (!candidates.some((candidate) => allowed.times.has(candidate))) missing.push(candidates[0]);
  }
  for (const number of found.numbers) {
    if (!number.values.some((value) => allowed.numbers.has(value) || allowed.numbers.has(Math.round(value * 10) / 10))) missing.push(number.text);
  }
  return missing;
}
