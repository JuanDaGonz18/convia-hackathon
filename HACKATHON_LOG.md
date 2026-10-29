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
- **PRs:** [#2](https://github.com/JuanDaGonz18/convia-hackathon/pull/2)
- **Notes:**
  - The icon font timeout only showed with the font delayed past 12 s; reproduced by delaying it 15 s (6 errors before, 0 after).
  - Supabase rejects custom e-mail templates on the free tier until custom SMTP is configured.
  - Next: translate the remaining screens (~70 files).


### October 27, 2026

- **Built:**
  - Spanish/English, phase 2a: every screen of the demo flow (add/verify vehicle, post trip, search, requests, trip details, profile, map) and the components they use. Plurals, weekday names, distances and the app's own error messages follow the language.
  - Web review fixes: one consistent text about who sees the plate (partial plate before requesting, full plate only for accepted passengers during the trip); Passenger/Driver cards fill the row on sign-up; sign-up checks the e-mail domain while typing and lists the enabled institutions; maps open on Chía / La Sabana; ConVía+ (plans, "+" badges, upgrade prompts) hidden behind a flag, off by default, since this is an academic, non-commercial project.
  - Vehicle autofill: Muse Spark proposes brand, line, color and plate from the vehicle photo; nothing is filled until the driver accepts, and every field stays editable.
- **Meta model:** Muse Spark 1.3 translated 673 new texts (~$0.16, reviewed for "trip"/"post" terminology) and powers the vehicle autofill (~$0.004 and 3–5 s per photo).
- **PRs:** [#3](https://github.com/JuanDaGonz18/convia-hackathon/pull/3)
- **Notes:**
  - Autofill on frames of the team's real clips: brand, line and color right on every frame of the registered car; plate right when visible and left empty when covered. On another car it read that car's plate correctly. Fields below a confidence threshold are never suggested.
  - suggest-vehicle deployed to the hackathon project.
  - Auth e-mails: Outlook Safe Links opens every link to scan it, which used up the one-time confirmation and reset links before the person clicked. The e-mails now open a page with a "Confirmar" / "Crear contraseña nueva" button, and the token is only used on that tap (changes to pre-existing files, not published here).
  - The model sometimes repeats the brand in the line ("Mazda Mazda 3"); the code strips it.
  - Pending: translating the remaining screens; notifications in the user's language (needs the locale on the profile); translating messages raised by the database and by the on-device face check; the legal documents in English; the 404 of the production web login page; e-mails to @unisabana.edu.co not arriving or held in quarantine.
  - Demo for the judges: Muse Image generated three fictional cars (plate CNV026, another car KTR418, the plate covered); turned into 3 s clips and run through the real verify-pickup pipeline: 3/3 as expected (verified in 5.3 s, mismatch in 7.3 s, retry in 7.3 s; about $0.04 each). Text in the images was legible enough for SAM and Muse to read.

### October 28, 2026

- **Built:** the demo for the judges.
  - A bilingual (English/Spanish) landing page with the problem, what was built, the demo video slot and links to the web app (at `/app/` on the same site) and the Android APK. `npm run build:demo-site` exports the web app and puts the landing at the root, ready for Cloudflare Pages.
  - Sample mode in "Verificar mi carro": demo accounts can't film the demo driver's car, so they pick one of three sample clips (the trip's car CNV 026, another car KTR 418, the plate covered). The clip and its frames come from a private bucket and go through the same real SAM 3.1 + Muse Spark pipeline; only the source of the files changes. Limited per demo passenger per day; other accounts get `SAMPLES_DEMO_ONLY`.
  - Demo organization with a confirmed demo driver and passenger, a vehicle and an accepted trip in the hackathon project (passwords are kept out of the repository).
  - verify-pickup redeployed to the hackathon project with sample mode; it still answers 401 without a session.
- **Meta model:** Muse Image 1.0 (`muse-image-1.0`) generated the three fictional sample cars and the landing's hero image; the landing labels it "Sample vehicle generated with Meta's Muse Image — fictional car and plate". The check itself is SAM 3.1 + Muse Spark 1.3.
- **PRs:** [#4](https://github.com/JuanDaGonz18/convia-hackathon/pull/4)
- **Notes:**
  - Test domains (`.test`) are not listed as enabled institutions at sign-up, so the demo organization stays invisible to real users (change to a pre-existing file, not published here).
  - Demo site live on Cloudflare Pages: https://convia-hackathon.pages.dev (landing at the root, web app at `/app/`). Three deploy problems found by testing the live URL, all fixed: Pages applies `_redirects` before static files, so a `/app/*` rule answered the app's JavaScript with HTML (blank page; the rules are now one per route, generated from `app/`); Pages never uploads folders named `node_modules`, where Expo puts the icon fonts (moved to `assets/vendor`); and on the web a sample's result never showed although the check ran (`app/pickup-verify.tsx`), nor did the samples after a reload (the profile now loads on the first session event).
  - Tested in the browser on the live site as the demo passenger: 3/3 as expected. Trip's car → "it's your ride" (CNV026, 0.98, 5.6 s); other car → "don't get in" (read KTR418, 0.95, 8.2 s); plate covered → "film again" (6.8 s). Times from tap to answer; the server part is 4.3–6.4 s.
  - Ready for several judges at once: five demo passengers, each with their own accepted trip with the demo driver (plates are unique, so one driver owns the CNV026 car the samples show). Destructive actions on demo accounts (cancel a trip or request, report a sample result, delete a vehicle or the account, change the password, edit the demo car) are shown disabled with "Disabled in demo mode", so nobody can break the shared demo. Sample checks are capped at 60 per account and 300 across all demo accounts per 24 h (about $0.04 each).

### October 28, 2026 (afternoon) — ride-matching agent, groundwork

- **Built:** the parts of the ride-matching agent that the agent loop will stand on (the loop, the confirm flow and the screen come next).
  - A chat client for Muse Spark Open (open weights) with Baseten Model APIs first and a Modal Shared Endpoint as automatic fallback. A timeout, network or HTTP error, invalid JSON or an empty reply on one provider goes to the next. Every answer records the provider, the model name the provider's response returned, its request id and (on Baseten) the deployment that served it; failed attempts are kept too.
  - Trace tables `agent_runs` and `agent_steps` with RLS: only the function writes, each user reads their own runs.
  - Read-only tools: `resolve_place` (saved places, then known places of the Sabana area, then a geocoder; ambiguous names come back as a question), `search_trips` and `trip_details`, which read the `available_trips` view with the user's own session (same organization, masked plates, no phones) and rank in code with the app's own matcher.
  - An evaluation set of 31 requests in English and Spanish against a fixed world (`evals/matching-agent`), including a full trip, a departed one, one from another organization and a prompt injection in a driver's note. A unit test runs every expected pick through the real ranking.
- **Meta model:** Muse Spark Open on Baseten (`meta-models/muse-spark-open-1026`) and Modal (`meta-models/Muse-Spark-Open-816B-A42B`), checked with one real call each.
- **PRs:** feat/matching-agent (not opened yet).
- **Notes:**
  - Both providers reason before answering and bill those tokens as output; with a 64-token limit Modal returned an empty reply. Steps get 1,024 tokens and an empty reply counts as a failed step.
  - Modal sends no request-id header, so the response's `id` is stored instead.
  - The app's matcher uses the device's time zone for "today" and "tomorrow"; Edge Functions run in UTC, so the agent's search takes an explicit Colombia date and time window.
  - Before submitting: run `judges-demo.mjs reset --yes` on November 4 (the demo trips must be in the future during judging) and put the six demo logins in the submission form.
### October 28, 2026 (evening) — one main branch, a 64 MB APK, and a UX batch

- **Built:**
  - Every finished branch merged into `main` (a fast-forward: all of them were already in one line); the live site now deploys from `main`.
  - Android APK from 200.6 MB to 64.1 MB: 64-bit ARM only (−63.7 MB), native libraries compressed in the APK (91 → 31 MB), R8 minification and resource shrinking (code 21.7 → 9.6 MB), with keep rules for the libraries that create Java objects from native code. Preview builds now increase the version code, so each one installs over the last.
  - Language selector: one segmented control with 44 dp segments on login, sign-up and Appearance; the language changes before it is saved, because saving first left the selector unresponsive when the device's secure storage was slow.
  - No shutter sound: the face check takes its photo with the sound off, and license, vehicle and vehicle-check photos use an in-app camera instead of the phone's camera app (whose sound an app can't turn off). Recording the pickup video makes no sound.
  - Drop-off point: the map (drag or tap the pin, address shown, confirm) is offered from the start, like the pick-up.
  - Boarding QR up front: the passenger's next trip shows on Home and on the trip, and from two hours before departure "Show my boarding QR" is the big button.
  - Profile → My reviews: what others said, as a driver and as a passenger, with the average.
  - "✨ AI by Meta" badge on Verify my car, the vehicle autofill and the vehicle AI check; tapping it says which model does what.
- **Meta model:** none new (the badge names SAM 3.1, Muse Spark 1.3 and Muse Spark Open where they are used).
- **PRs:** feat/ux-batch
- **Notes:** next: open sign-up with institution verification by student card (Muse Spark), then the matching agent.

### October 28, 2026 (night) — open sign-up, verified institutions, student ID with Muse Spark

- **Built:**
  - Any e-mail can sign up. Institutional e-mail domains (now several per institution) are still verified at once; everyone else chooses an institution after logging in (the search shows matches only after 3 letters; the full list is never readable) and verifies it, or asks for it to be added ("My institution isn't listed").
  - The rule that protects everything: `profiles.institution_id` is set only once the membership is verified. Every "same institution" policy already reads it, so pending users see no trips, people or chats without touching those policies; publishing and requesting seats also require a verified institution (before, an empty institution compared equal to another empty one).
  - Student ID verification. On the phone or in the browser, the card's face is found with the same on-device models as the selfie check, compared with the user's selfie, and **left out**: only crops of the card around it are sent, so no face pixels reach the server or Meta. The new `verify-student-id` function has Muse Spark 1.3 read the crops as strict JSON (name, institution, ID number, expiry, physical card or screen/copy) and code decides: institution, expiry, name (accent- and order-insensitive) and face must all match to verify; any doubt goes to manual review, never an automatic rejection; an unreadable photo asks to try again. Only the result is stored: reason codes, last 4 ID digits, expiry; no image and no name.
  - Seed: major Colombian universities (QS 2026 press coverage): Los Andes, Nacional, Javeriana, Antioquia, Rosario, EAFIT, Externado, UPB and Universidad del Norte, with their mail domains (each checked against the university's own mail servers); La Sabana unchanged. Existing users stay verified.
  - Screens: choose your institution, add my institution, verify with my student ID, and a "verify your institution" card on Home, Trips and Chats. Spanish and English.
- **Meta model:** Muse Spark 1.3 reads the student ID crops (strict JSON).
- **PRs:** feat/institution-verification
- **Notes:**
  - Tested: the decision rules (9 cases), that no crop ever overlaps the face box in an exhaustive sweep of positions, the database migration on the hackathon project (existing users verified, search rules, anonymous access to the institution list blocked), and the deployed function (401 without a session). Not yet tested end to end with a real card: that needs a new, unverified account.
  - The pending request and manual reviews are handled in the database dashboard for now.

### October 28, 2026 (late night) — open sign-up fix; student card without photo

- **Built:**
  - Fix: sign-up with a personal e-mail was still refused. The app checked the domain itself before calling sign-up, so the open sign-up on the server was never reached. That check is gone; e-mail fields say "Email" with no example domain or institution name anywhere; HTML pages are served with `Cache-Control: no-cache`.
  - "My student card has no photo": the user uploads the card's front and a screenshot of their institutional account (Teams, Outlook or the student portal), cropped to name and e-mail. The device first checks that neither image shows a face: a card with a photo goes to the automatic path, and a screenshot with a profile picture must be cropped. Muse Spark 1.3 reads both as strict JSON, and code compares the names (card, screenshot and profile), the e-mail's domain against the institution's, the expiry and signs of editing.
  - This path never verifies by itself, because screenshots are easy to fake: when everything matches it goes to manual review with a summary for the reviewer, any mismatch is flagged, and unreadable images ask to try again. Only the result, the reason codes and the e-mail's domain are stored. Profile shows "Verified with photo ID" or "Verified with document".
- **Meta model:** Muse Spark 1.3 reads the card and the account screenshot (strict JSON).
- **PRs:** feat/institution-verification
- **Notes:** a new account on the live site chose its institution and is pending: open sign-up works end to end up to verification.

### October 28, 2026 (night) — matching agent

- **Built:**
  - "Find your trip" assistant: the passenger writes where they leave from, where they go and when (Spanish or English); an agent finds places, searches trips with the app's own matcher, proposes one seat, and the passenger confirms. The agent never requests a seat by itself.
  - Loop with two phases and a tool allowlist per phase, at most 8 model turns and 40 s, every turn a tool call with a short plan note. Checkpoint 1: the parsed request (places as references to lookups made in this run, date, window, seats) is checked by code before any search and frozen. Checkpoint 2, inside the propose tool: the trip is re-read (still open, seats left, same verified institution, inside the window, not already requested, no clash, unchanged), every number in the explanation must be that trip's data, then Muse Spark 1.3 checks each claim. Up to 3 retries with the failures as feedback.
  - Confirm is bound to a SHA-256 of the proposal (trip, seats, price, departure, pickup, drop-off), re-checked against the database, used once, valid 10 minutes, and the request is created with the passenger's own session. Disabled on demo accounts.
  - Progress streams to the screen (understanding → searching → choosing → verifying); "How the assistant decided" shows every step: plan, provider, model, request id, latency, cost and the judge's claims. Phones and full plates are masked in the stored trace.
  - Eval: 32 cases (picks, no match, clarify, proposal, refusal, prompt injection in a driver note) run against the deployed function with fixture data and the real models.
  - First live run fixes: one search per run (the request is frozen, so a repeat can only return the same), "no match" right after an empty search, and a trip checkpoint 2 can't propose (already requested, full, clash) is dropped without spending a retry.
- **Meta model:** Muse Spark Open (`muse-spark-open-1026` on Baseten; Modal Shared Endpoint as fallback) runs the agent; Muse Spark 1.3 is the claim judge.
- **PRs:** feat/matching-agent
- **Notes:**
  - Eval on Baseten: 100% of passenger cases, 0 proposals wrongly marked verified, 0 safety violations, p50 8.0 s, p95 14–17 s (target 12 s, not met yet), about $0.006 per run. Modal: 96%, p95 22 s.
  - Live on the hackathon project with the demo passenger: a verified proposal (Confirm disabled in demo), an honest "you already requested that trip", and an honest "no trips" answer.
  - Drivers are outside v1: the agent only helps passengers.

### October 28, 2026 (before midnight) — pickup at night; assistant language and speed

- **Built:**
  - Pickup check: 4 new real clips of the same car (approaching, night with light, night with low light, night blurry). When the middle frame is only good for "film again", the frame where SAM saw the plate best is read once more before asking to retry: the approaching car went from "film again" to "it's your ride". At night, no clip gave a false "don't get in"; the plates that were too small or blurred to read gave "film again". The SAM threshold (0.5) was checked from 0.3 to 0.8 and picks the same car and plate on every clip, so it stays.
  - Assistant replies in the language of each message (the screen keeps the app's language); on the web, Enter sends and Shift+Enter adds a line.
  - Assistant reliability: a place it already looked up is not looked up again, a place that was not found ends with a question to the user, and the eval now keeps the steps of any failed case.
  - Assistant speed: every place in one lookup (one model turn fewer), and the claim judge at minimal reasoning effort after checking it on 12 explanations with a known answer (36/36 right, no unsupported claim passed).
- **Meta model:** SAM 3.1 + Muse Spark 1.3 (pickup); Muse Spark Open (assistant); Muse Spark 1.3 (judge).
- **PRs:** feat/matching-agent
- **Notes:** eval on Baseten, 36 cases (4 new for reply language): 100% passed, 0 proposals wrongly marked verified; p50 7.6 s → 5.2 s and p95 17.0 s → 9.6 s, now under the 12 s target. Pickup on 7 real clips: 6 as expected; the night-with-light clip stays "film again" because the plate is about 60 px wide in the 720p recording.

### October 29, 2026

- **Built:**
  - Fix: publishing a trip or requesting a seat failed on the hackathon project since the institution migration (Oct 28). The trigger that requires a verified institution read the driver and the passenger in one expression, which PL/pgSQL resolves for both tables; it now reads only the field of the table being written. Found while testing the demo job below.
  - The judges' demo keeps itself alive: a daily database job (pg_cron, 04:00 Colombia) clears the demo accounts' pickup checks, removes their old trips, and gives each demo passenger an accepted ride 1–3 days ahead. It touches only `@demo.convia.test` accounts.
  - README: how to try each feature, and the privacy notes for the student ID check and the assistant.
- **Meta model:** none new.
- **PRs:** feat/matching-agent
- **Notes:** both changes were tested inside transactions that were rolled back: the job created the five rides, a second run kept them, and the real data was unchanged.

### October 29, 2026 (afternoon) — independent review fixes

- **Built:** fixes from a read-only review of the whole hackathon scope by a separate Claude session.
  - A pickup clip is now deleted even if the app disconnects while the answer is streaming.
  - Every pickup attempt is recorded before the paid model call, so errors and parallel calls count toward the caps; filmed clips also have daily caps per passenger and in total.
  - The assistant's evaluation endpoint only accepts the exact service key.
  - Demo accounts can't delete their account or remove or change the shared demo car, and the daily demo job only serves the five known demo passengers.
  - Confirm no longer returns a server error when the database fails; the institution search treats `%` and `_` as plain text; the public-sync check also catches project references and Baseten/Modal keys; email confirmation is pinned in the project's auth settings (it was already on).
- **Meta model:** none new.
- **PRs:** [#8](https://github.com/JuanDaGonz18/convia-hackathon/pull/8)
- **Notes:**
  - New tests: the answer stream's clean-up on disconnect, the attempt caps, a forged service token, Confirm on a database error, and a SQL check run inside a rolled-back transaction (trip and seat-request inserts, the demo car lock, the daily job, the literal search). A live sample check saved its result as expected.
  - Deferred, with reasons: the vehicle-autofill hourly limit lives in memory (needs a database counter; the function is cheap and requires sign-in); plates written in lowercase in the assistant's trace (a looser pattern would also mask ordinary text); a stricter student-ID name match and detecting a faint second photo on a card (both change verification decisions and need their own testing; doubtful cases already go to manual review); a retried pickup request can be charged twice (now bounded by the caps); a parked copy of the trip's car could in theory trigger the early exit (unlikely; fixing it changes the pipeline and needs all real clips re-run).

### October 29, 2026 (evening) — user-reported fixes; plans hidden

- **Built:**
  - The "verify your institution" card showed a bare `{{name}}`; it now uses the user's first name, or a neutral title, and names the institution with a fallback.
  - Student ID: when the device can't use the photo on the card, the user sees why and chooses **Try again** or **Request a manual review**; nothing is sent until then (before, any miss went straight to review). On the web, the card is also scanned in smaller, enlarged tiles for small printed portraits; the detection threshold is unchanged, so a wrong "face" can never move the crop onto the real one.
  - Manual review has a written policy and a tool (`hackathon/admin/review-institutions.mjs`): list, approve, or reject with a reason the app shows. No card image is stored, so reviewers decide from the recorded checks. The two test accounts left in review were rejected as "unclear".
  - "Appearance & language" opened a "page not found": the web router strips its `/app` base path as plain text, so `/appearance` became `/app/earance`. The screen now lives at `/display`.
  - Spanish/English on ten more screens (statistics, preferences, trip history, routes and alerts, favorite drivers, my places, terms and privacy, personal info, messages, trip chat). The English legal texts are a Muse Spark translation through the same checked pipeline, with a note that the Spanish version applies.
  - With `EXPO_PUBLIC_SHOW_PLANS` off, nothing plan-related appears: the ConVía+ avatar ring, the "· ConVía+" labels, the stats unlock button and plan wording in error messages are hidden, and `/plus` redirects home.
- **Meta model:** Muse Spark 1.3 (English texts and legal translation).
- **PRs:** fix/user-reported-bugs, fix/hide-plans
- **Notes:** checked live in English on every listed screen, and no plan text on sixteen screens. The new card-detection pass is not yet measured on a real card.

### October 30, 2026

### October 31, 2026

### November 1, 2026

### November 2, 2026

### November 3, 2026

### November 4, 2026
