import { supabase } from '@/lib/supabase';

/** A review someone left about the signed-in user (RLS: only ratings where they are rated or rater). */
export type Review = {
  id: string;
  score: number;
  comment: string | null;
  createdAt: string;
  /** The role the user had in that trip. */
  as: 'driver' | 'passenger';
  /** First name only. */
  raterName: string | null;
};

export type ReviewSummary = { average: number | null; count: number };

export function summarize(reviews: Review[]): ReviewSummary {
  if (!reviews.length) return { average: null, count: 0 };
  const average = reviews.reduce((sum, review) => sum + review.score, 0) / reviews.length;
  return { average: Math.round(average * 10) / 10, count: reviews.length };
}

export const reviewService = {
  /** Reviews about the signed-in user, newest first. */
  async getMyReviews(): Promise<Review[]> {
    const { data: auth } = await supabase.auth.getUser();
    const me = auth.user?.id;
    if (!me) return [];
    const { data, error } = await supabase
      .from('ratings')
      .select('id, score, comentario, created_at, rated_role, rater_id')
      .eq('rated_id', me)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    const raterIds = [...new Set((data ?? []).map((row) => row.rater_id))];
    // Raters of the same organization are visible (profiles RLS); anyone else stays anonymous.
    const { data: raters } = raterIds.length
      ? await supabase.from('profiles').select('id, nombre').in('id', raterIds)
      : { data: [] as { id: string; nombre: string }[] };
    const names = new Map((raters ?? []).map((rater) => [rater.id, rater.nombre.trim().split(/\s+/)[0] || null]));
    return (data ?? []).map((row) => ({
      id: row.id,
      score: row.score,
      comment: row.comentario?.trim() || null,
      createdAt: row.created_at,
      as: row.rated_role === 'conductor' ? 'driver' : 'passenger',
      raterName: names.get(row.rater_id) ?? null,
    }));
  },
};
