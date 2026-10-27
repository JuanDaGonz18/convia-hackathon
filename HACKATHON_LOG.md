# Hackathon log

Daily record of what was built for the Meta Global AI Developer Hackathon.
Building period: from the end of the kickoff session on **October 26, 2026** (about 11:24 AM Colombia time) to **November 4, 2026**. All times are Colombia time (UTC−5).

> The building period was first announced as starting on October 27. On October 26 at 9:57 AM, the Cerebral Valley team corrected it in the hackathon's #faqs channel: "Correction: building period is officially after the kickoff session!"

This repository contains only work from the building period; pre-existing ConVía code is not included (see the [README](README.md#what-existed-before-the-event-not-in-this-repository)). Each entry lists only what was built, with the Meta model it uses and the pull request where it landed.

## Before the building period (pre-existing work)

### October 25, 2026 — vehicle verification prepared

Not part of the submission and not in this repository. A first version of AI vehicle verification: the `verify-vehicle` Edge Function (SAM 3.1 + Muse Spark 1.3), its decision logic (`decision.ts`), the `vehicle_verifications` table, the app's verification step and tests. The five commits keep their original timestamps on the [`hackathon/convia-verify` branch of WheelsApp](https://github.com/JuanDaGonz18/WheelsApp/compare/709ca03...hackathon/convia-verify).

### October 26, 2026, before the kickoff ended — working copy prepared

No feature work. A private working copy of ConVía (the app plus the October 25 work) with keys and private references removed.

## Building period

<!--
Template for each entry:

### October 27, 2026

- **Built:** what now works that did not before.
- **Meta model:** which model and what for (or "none").
- **PRs:** #
- **Notes:** decisions, problems, what is next.
-->

### October 26, 2026 (after the kickoff)

- **Built:** no features yet; setup only.
  - This extract repository, and the script that publishes to it only files created during the event.
  - The hackathon's Supabase project, with ConVía's existing database migrations applied.
  - A fix so the type check passes on a clean clone with TypeScript 6 (changes to pre-existing configuration files; not published here).
- **Meta model:** none.
- **PRs:** none.

### October 26, 2026 (afternoon) — verify-pickup

- **Built:** "Verificar mi carro": when their request is accepted, the passenger films the arriving car for up to 5 seconds and learns whether it is the trip's car (✅ it's your ride / 🚨 don't get in / 🔄 film again). New Edge Function `verify-pickup`, a `pickup_verifications` table with RLS, a private bucket for clips, a report RPC, and the app screen with visible progress.
- **Meta model:** SAM 3.1 on video (prompts "car" and "license plate", tracked across frames and filtered by confidence) picks the arriving car and the frame where its plate is clearest; Muse Spark 1.3 reads that frame with strict JSON output.
- **PRs:** [#1](https://github.com/JuanDaGonz18/convia-hackathon/pull/1)
- **Notes:**
  - Measured with the real API before writing code: Muse Spark on the whole video took 42 s and misplaced objects, so the app extracts a frame every 0.5 s and Muse reads only the one SAM points to (~5 s).
  - Uploading the clip to the Files API added ~9 s (upload + delete) for a 3 KB file; sending it inline as base64 cut SAM's step from ~14 s to ~6 s, and nothing is ever stored at the provider.
  - A SAM line is not tracking: a lost object kept a box with confidence 0.0003, so every detection is filtered by a configurable threshold (0.5 for now).
  - The clip and frames are deleted from Storage after every check; only the result is stored.
  - First real clips (3, parked car, filmed with a phone and cut to what the app records: 3 s, 720p): the covered plate gave "film again"; the visible plate and another car of the same model were read with plate confidence 0.98 (still to be checked against the real plates). On these clips SAM gives each object one confidence for the whole clip (0.88–0.98), so every threshold from 0.3 to 0.8 picks the same car and plate; 0.5 stays until the moving-car and night clips.
  - The covered plate first came back as "blurry video": the schema asked Muse for image quality as "how well the plate can be seen". Rewritten as sharpness and lighting only, it now says the plate is unreadable.
  - "Don't get in" now needs confidence: another plate or brand or color at ≥ 0.85, and colors light can change into each other (gray ≈ silver ≈ dark blue…) never count. Any doubt is "film again".
  - Clips cut from 5 s to 3 s: measured cost $0.025–0.039 per check (was ~$0.065 estimated), latency 13–27 s end to end.
  - Migration and function deployed to the hackathon's Supabase project.

### October 26, 2026 (late afternoon) — verify-pickup under 10 seconds

- **Built:** the verify-pickup function now answers in 6–8 s instead of 13–27 s, with the same accuracy (3/3 real clips; measured from the request to the answer, without the phone's upload), and the screen shows real progress: car detected ✓ → plate found ✓ → reading the plate → result.
- **Meta model:** SAM 3.1 now streams its answer frame by frame; Muse Spark 1.3 runs with `reasoning_effort: minimal` and starts at the same time as SAM.
- **PRs:** [#1](https://github.com/JuanDaGonz18/convia-hackathon/pull/1)
- **Notes:**
  - Measured each step first: SAM's first line arrives at 2.6–5.2 s and its last at 6.4–7.8 s; Muse took 6–7 s at `low` and 3–4 s at `minimal`, with the same readings on the 3 clips.
  - Muse no longer waits for SAM: it reads the middle frame while SAM streams. If SAM ends up placing the main car's plate elsewhere, that reading is dropped and SAM's frame is read.
  - Early exit only for "it's your ride": once Muse read the trip's plate and SAM's stream shows that plate on the main car (5+ frames), the answer goes out without waiting for the rest of the stream. "Don't get in" still waits for the whole clip.
  - The function streams its progress as NDJSON; the answer is sent before the row is saved and the files are deleted.
  - In the app, the clip uploads while frames are being extracted.

### October 26, 2026 (evening) — web fixes, Spanish/English, password recovery

- **Built:**
  - Web: icons no longer fail with an uncaught 12 s font timeout; the app is a centered phone-width column on computers; links to a tab switch tabs instead of stacking a second tab navigator (changes to pre-existing files, not published here).
  - "Remember me" now decides whether the session survives closing the tab or app; password recovery by e-mail with a new-password screen.
  - Spanish/English with a language picker on login, sign-up and Profile → Appearance & language. Translated so far: login, sign-up, password recovery, "Verificar mi carro", tab bar, dates and prices.
  - Branded auth e-mails (confirmation, recovery, e-mail change) for the hackathon project, after setting up SMTP.
- **Meta model:** Muse Spark 1.3 translated the Spanish texts into English (246 keys, about $0.06), with every key and {{placeholder}} checked; then reviewed by hand (terminology, apostrophes).
- **PRs:** feat/i18n-auth
- **Notes:**
  - The icon font timeout only showed with the font delayed past 12 s; reproduced by delaying it 15 s (6 errors before, 0 after).
  - Supabase rejects custom e-mail templates on the free tier until custom SMTP is configured.
  - Next: translate the remaining screens (~70 files).

### October 27, 2026

### October 28, 2026

### October 29, 2026

### October 30, 2026

### October 31, 2026

### November 1, 2026

### November 2, 2026

### November 3, 2026

### November 4, 2026
