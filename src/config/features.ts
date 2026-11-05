/**
 * ConVía+ (plans, prices, "Tu plan", upgrade prompts and the "+" badges).
 * Off unless EXPO_PUBLIC_SHOW_PLANS=true: this build is an academic,
 * non-commercial project. With it off, the server still decides what each
 * user can do (during the beta everyone gets the ConVía+ limits); the app
 * just never talks about plans.
 */
export const PLANS_ENABLED = process.env.EXPO_PUBLIC_SHOW_PLANS === 'true';

/**
 * Push notifications. Off unless EXPO_PUBLIC_PUSH_NOTIFICATIONS=true: the current demo build has
 * no Firebase configuration (Android can't get a push token) and the notify function isn't
 * deployed, so the app neither asks for the permission nor shows notification switches. Screens
 * keep updating through realtime. Turn it on only in a build that has both.
 */
export const PUSH_NOTIFICATIONS_ENABLED = process.env.EXPO_PUBLIC_PUSH_NOTIFICATIONS === 'true';
