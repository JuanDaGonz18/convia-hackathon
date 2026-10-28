/**
 * verify-student-id: what Muse Spark read from the card crops → verified, review or retry.
 * Code decides, never the model. Nothing is auto-rejected: any doubt goes to manual review,
 * and only an unreadable photo asks to try again.
 * Pure TypeScript, unit-tested with `npm run test:functions`.
 */

/** Muse Spark's strict JSON about the card (read from crops that exclude the face). */
export type CardReport = {
  is_student_id_card: boolean;
  looks_like_screen_or_printout: boolean;
  readable: boolean;
  full_name: string | null;
  institution_name: string | null;
  id_number: string | null;
  /** As printed: "2026-12-31", "12/2026", "31/12/2026", "2026"… */
  expiry_date: string | null;
  confidence: number;
};

export type InstitutionRef = { nombre: string; nombre_corto: string | null; dominios: string[] };

export type Reason =
  | 'unreadable'
  | 'not_a_card'
  | 'screen_or_print'
  | 'institution_mismatch'
  | 'no_expiry'
  | 'expired'
  | 'name_partial'
  | 'name_mismatch'
  | 'face_mismatch'
  /** No face comparison (web: no on-device face model). */
  | 'face_not_checked'
  | 'low_confidence';

export type CardDecision = {
  decision: 'verified' | 'review' | 'retry';
  reasons: Reason[];
  nameSimilarity: number;
  institutionRead: string | null;
  idLast4: string | null;
  /** YYYY-MM-DD, the last valid day. */
  expiresOn: string | null;
};

export const MIN_CONFIDENCE = 0.7;

/** Words that don't identify a person or an institution. */
const NAME_PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
const INSTITUTION_WORDS = new Set([...NAME_PARTICLES, 'universidad', 'pontificia', 'colombia', 'fundacion', 'universitaria', 'corporacion', 'institucion']);

export function normalize(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const tokens = (text: string, skip: Set<string>) => normalize(text).split(' ').filter((token) => token.length >= 2 && !skip.has(token));

/** Share of the profile's name words found on the card (1 = all of them, in any order). */
export function nameSimilarity(profileName: string, cardName: string | null) {
  const wanted = tokens(profileName, NAME_PARTICLES);
  if (!wanted.length || !cardName) return 0;
  const found = new Set(tokens(cardName, NAME_PARTICLES));
  return wanted.filter((token) => found.has(token)).length / wanted.length;
}

/** The card names the chosen institution: its distinctive words, its short name or a domain's first label. */
export function institutionMatches(read: string | null, institution: InstitutionRef) {
  if (!read) return false;
  const text = ` ${normalize(read)} `;
  const key = tokens(institution.nombre, INSTITUTION_WORDS);
  if (key.length && key.every((token) => text.includes(` ${token} `))) return true;
  const short = institution.nombre_corto ? normalize(institution.nombre_corto) : '';
  if (short.length >= 3 && text.includes(` ${short} `)) return true;
  return institution.dominios.some((domain) => {
    const label = normalize(domain.split('.')[0]);
    return label.length >= 3 && text.includes(` ${label} `);
  });
}

const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const iso = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** The last valid day printed on the card, or null when it can't be read. */
export function parseExpiry(value: string | null): string | null {
  if (!value) return null;
  const text = value.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (m) return iso(+m[3], +m[2], +m[1]);
  m = /^(\d{4})-(\d{1,2})$/.exec(text) ?? null;
  if (m) return iso(+m[1], +m[2], lastDay(+m[1], +m[2]));
  m = /^(\d{1,2})[/.-](\d{4})$/.exec(text);
  if (m) return iso(+m[2], +m[1], lastDay(+m[2], +m[1]));
  m = /^(\d{4})$/.exec(text);
  if (m) return iso(+m[1], 12, 31);
  return null;
}

/** Only the last 4 letters or digits of the ID are kept. */
export function idLast4(idNumber: string | null) {
  const clean = (idNumber ?? '').replace(/[^0-9A-Za-z]/g, '');
  return clean ? clean.slice(-4) : null;
}

export function decideCard(
  report: CardReport,
  { profileName, institution, faceMatch, today }: { profileName: string; institution: InstitutionRef; faceMatch: boolean | null; today: string },
): CardDecision {
  const base = {
    nameSimilarity: Math.round(nameSimilarity(profileName, report.full_name) * 100) / 100,
    institutionRead: report.institution_name?.slice(0, 200) ?? null,
    idLast4: idLast4(report.id_number),
    expiresOn: parseExpiry(report.expiry_date),
  };
  if (!report.readable || (!report.full_name && !report.institution_name)) {
    return { decision: 'retry', reasons: ['unreadable'], ...base };
  }
  const reasons: Reason[] = [];
  if (!report.is_student_id_card) reasons.push('not_a_card');
  if (report.looks_like_screen_or_printout) reasons.push('screen_or_print');
  if (!institutionMatches(report.institution_name, institution)) reasons.push('institution_mismatch');
  if (!base.expiresOn) reasons.push('no_expiry');
  else if (base.expiresOn < today) reasons.push('expired');
  if (base.nameSimilarity < 0.5) reasons.push('name_mismatch');
  else if (base.nameSimilarity < 1) reasons.push('name_partial');
  if (faceMatch === null) reasons.push('face_not_checked');
  else if (!faceMatch) reasons.push('face_mismatch');
  if (!(report.confidence >= MIN_CONFIDENCE)) reasons.push('low_confidence');
  return { decision: reasons.length ? 'review' : 'verified', reasons, ...base };
}
