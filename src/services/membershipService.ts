import { useEffect, useSyncExternalStore } from 'react';

import { isSupabaseEnabled, supabase } from '@/lib/supabase';

/**
 * The user's institution: which one they chose and whether it is verified. Until it is
 * verified the server hides trips, people and chats (RLS) and refuses to publish or request
 * seats; screens use useMembership() to explain why and offer the verification.
 */
export type MembershipStatus = 'none' | 'pending' | 'review' | 'verified';
export type StudentCardDecision = 'verified' | 'review' | 'retry';

export type Membership = {
  status: MembershipStatus;
  /** student_card_photo: card with photo, verified automatically · document: card without photo + account screenshot, approved by a person. */
  method: 'institutional_email' | 'microsoft' | 'student_card_photo' | 'document' | null;
  institution: { id: string; nombre: string; nombre_corto: string | null; ciudad: string | null } | null;
  hasMicrosoft: boolean;
  request: { nombre: string; estado: 'pendiente' | 'aprobada' | 'rechazada'; created_at: string } | null;
  lastCheck: { decision: StudentCardDecision; kind: 'card_photo' | 'document'; reasons: string[]; created_at: string } | null;
};

export type InstitutionResult = { id: string; nombre: string; nombre_corto: string | null; ciudad: string | null };
export type InstitutionRequestRole = 'estudiante' | 'profesor' | 'administrativo' | 'otro';

/** Without a server (demo mode) everyone counts as verified. */
const OFFLINE: Membership = { status: 'verified', method: null, institution: null, hasMicrosoft: false, request: null, lastCheck: null };

let current: Membership | null = null;
let loading: Promise<Membership> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function parse(raw: Record<string, unknown> | null): Membership {
  const data = raw ?? {};
  return {
    status: (['pending', 'review', 'verified'].includes(String(data.status)) ? data.status : 'none') as MembershipStatus,
    method: (data.method as Membership['method']) ?? null,
    institution: (data.institution as Membership['institution']) ?? null,
    hasMicrosoft: data.has_microsoft === true,
    request: (data.request as Membership['request']) ?? null,
    lastCheck: (data.last_check as Membership['lastCheck']) ?? null,
  };
}

export const membershipService = {
  /** Reloads the status from the server (after choosing, verifying or on focus). */
  async refresh(): Promise<Membership> {
    if (!isSupabaseEnabled) {
      current = OFFLINE;
      emit();
      return OFFLINE;
    }
    loading ??= (async () => {
      try {
        const { data, error } = await supabase.rpc('my_institution');
        if (error) throw error;
        current = parse(data as Record<string, unknown> | null);
        emit();
        return current;
      } finally {
        loading = null;
      }
    })();
    return loading;
  },

  /** Forget the status (sign-out / another account). */
  clear() {
    current = null;
    emit();
  },

  /** Up to 10 active institutions; nothing for fewer than 3 characters (the server enforces it too). */
  async search(query: string): Promise<InstitutionResult[]> {
    if (query.trim().length < 3) return [];
    const { data, error } = await supabase.rpc('search_institutions', { p_query: query.trim() });
    if (error) throw error;
    return (data ?? []) as InstitutionResult[];
  },

  async choose(institutionId: string) {
    const { error } = await supabase.rpc('choose_institution', { p_institution_id: institutionId });
    if (error) throw error;
    await membershipService.refresh();
  },

  async requestInstitution(form: { nombre: string; ciudad: string; sitioWeb: string; rol: InstitutionRequestRole }) {
    const { error } = await supabase.rpc('request_institution', {
      p_nombre: form.nombre, p_ciudad: form.ciudad, p_sitio_web: form.sitioWeb, p_rol: form.rol,
    });
    if (error) throw error;
    await membershipService.refresh();
  },

  /** The card's face embedding (computed on the phone) against the user's selfie. */
  async submitCardFace(embedding: number[]) {
    const { error } = await supabase.rpc('submit_student_card_face', { p_embedding: embedding });
    if (error) throw error;
  },

  /**
   * Card without photo + institutional account screenshot (both checked on the device to show no face).
   * Never verified automatically: the result is 'review' (a person approves) or 'retry'.
   */
  async verifyDocument(card: string, screenshot: string): Promise<{ decision: StudentCardDecision; reasons: string[] }> {
    const { data, error } = await supabase.functions.invoke('verify-student-id', { body: { mode: 'document', card, screenshot } });
    if (error) {
      const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
      throw new Error(String(body?.error ?? error.message));
    }
    await membershipService.refresh();
    return data as { decision: StudentCardDecision; reasons: string[] };
  },

  /** Crops of the card around the face (base64 JPEG). No crops = the face couldn't be excluded: manual review. */
  async verifyCard(crops: string[]): Promise<{ decision: StudentCardDecision; reasons: string[] }> {
    const { data, error } = await supabase.functions.invoke('verify-student-id', { body: { crops } });
    if (error) {
      const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
      throw new Error(String(body?.error ?? error.message));
    }
    await membershipService.refresh();
    return data as { decision: StudentCardDecision; reasons: string[] };
  },
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The current membership (null while loading). Loads it on first use. */
export function useMembership(): Membership | null {
  const value = useSyncExternalStore(subscribe, () => current, () => current);
  useEffect(() => {
    if (!current) void membershipService.refresh().catch(() => undefined);
  }, []);
  return value;
}
