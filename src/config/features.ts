/**
 * ConVía+ (plans, prices, "Tu plan", upgrade prompts and the "+" badges).
 * Off unless EXPO_PUBLIC_SHOW_PLANS=true: this build is an academic,
 * non-commercial project. With it off, the server still decides what each
 * user can do (during the beta everyone gets the ConVía+ limits); the app
 * just never talks about plans.
 */
export const PLANS_ENABLED = process.env.EXPO_PUBLIC_SHOW_PLANS === 'true';
