/**
 * WHAT this run is for: the user's request, wrapped as data. Kept apart from instructions.ts so a
 * request can never rewrite the agent's rules.
 */
import { bogotaLabel } from './search.ts';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type Objective = { text: string; language: 'es' | 'en'; now: Date };

/** The user's message is limited and stripped of anything that could close the objective block. */
export function buildObjective({ text, language, now }: Objective) {
  const clean = text.replaceAll('<', '‹').replaceAll('>', '›').trim().slice(0, 500);
  const local = bogotaLabel(now);
  const weekday = WEEKDAYS[new Date(`${local.slice(0, 10)}T12:00:00Z`).getUTCDay()];
  return [
    '<objective>',
    `now_colombia: ${local} (${weekday})`,
    'role: passenger',
    `language: ${language}`,
    `request: ${clean}`,
    '</objective>',
  ].join('\n');
}
