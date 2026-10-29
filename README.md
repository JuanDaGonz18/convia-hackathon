# ConVía — Meta Global AI Developer Hackathon extract

This repository is an **extract**: it contains **only the code written during the Meta Global AI Developer Hackathon** (building period: from the end of the kickoff session on **October 26, 2026** to **November 4, 2026**). Nothing that existed before the event is included.

The new code is part of **ConVía**, a carpooling app for university students and staff in Chía and the Sabana area (Colombia). ConVía was developed before the event in a separate repository. Here, every file keeps the path it has inside ConVía, so its location shows where it plugs into the app. Where the new code calls existing ConVía code, that code is listed as an external dependency (see [Pre-existing code it depends on](#pre-existing-code-it-depends-on)), not copied.

- **Daily log:** [HACKATHON_LOG.md](HACKATHON_LOG.md)
- **Every change lands through a pull request** that states what was built, which Meta model it uses and how to test it.

## Demo

<!-- Replace with the final links. -->
- Video: _coming soon_
- Live app: https://convia-hackathon.pages.dev (web app at `/app/`; judges log in with the demo accounts from the submission form)

### How to try it

The demo accounts (one driver and five passengers) are in the submission form, not in this repository. The app follows the browser's language; Spanish or English can also be chosen on the login screen or in Profile → Appearance & language. Each passenger always has an accepted ride with the demo driver one to three days ahead (a daily job keeps it that way during judging).

1. **Pickup check** (passenger): Home → *Your next ride* → **Verify my car**. Demo accounts can't film the demo car, so they pick one of three sample clips (the trip's car, another car, the plate covered) and the real SAM 3.1 + Muse Spark check runs on it.
2. **Trip assistant** (passenger): Home → **✨ Ask the assistant** → describe a trip in Spanish or English, e.g. "From Universidad de La Sabana to Fontanar tomorrow at 11 am". Watch the steps, the proposal marked *Verified*, and **How the assistant decided** (every step, the model that answered and the judge's claims). Confirm is disabled for demo accounts.
3. **Vehicle autofill** (driver): add a vehicle and choose its photo; Muse Spark suggests brand, line, color and (only if fully legible) plate.
4. **Student ID check**: create an account with any personal e-mail, choose an institution, then **Verify with my student ID** (your own card; the face is compared on the device and never sent).

## Built during the hackathon

| Feature | Meta model | PR | Demo timestamp |
| --- | --- | --- | --- |
| **Pickup check** ("Verificar mi carro"): the passenger films the arriving car for 3 s; SAM tracks the car and its plate across frames and Muse Spark reads the plate from the best frame, then code decides: it's your ride / don't get in / film again | SAM 3.1 + Muse Spark 1.3 | [#1](https://github.com/JuanDaGonz18/convia-hackathon/pull/1) | |
| **Spanish / English**: i18next with a language picker (Sistema / Español / English); the English texts are generated from the Spanish ones by a script that sends them to Muse Spark in batches, checks every key and {{placeholder}}, and never overwrites reviewed text | Muse Spark 1.3 | [#2](https://github.com/JuanDaGonz18/convia-hackathon/pull/2) | |
| **"Remember me" and password recovery**: keep the session or end it with the tab/app; reset link by e-mail and a new-password screen | — | [#2](https://github.com/JuanDaGonz18/convia-hackathon/pull/2) | |
| **Sign-up domain check**: while typing the e-mail, says whether its institution is enabled and lists the enabled ones | — | [#3](https://github.com/JuanDaGonz18/convia-hackathon/pull/3) | |
| **Vehicle autofill**: from the vehicle photo, Muse Spark proposes brand, line, color and (only if fully legible) plate; the driver confirms or corrects every field. The photo is not stored | Muse Spark 1.3 | [#3](https://github.com/JuanDaGonz18/convia-hackathon/pull/3) | |
| **Demo for the judges**: bilingual landing page with the web app at `/app/`; demo accounts can run the real pickup check on three sample clips of fictional cars (the trip's car, another car, the plate covered) instead of filming | SAM 3.1 + Muse Spark 1.3 (check); Muse Image 1.0 (sample cars) | [#4](https://github.com/JuanDaGonz18/convia-hackathon/pull/4) | |
| **Everyday polish**: language selector (one control, applied before it is saved), photos without the shutter sound, next ride on Home with the boarding QR as the main button near departure, "My reviews" (as driver and as passenger, with the average), and the "✨ AI by Meta" badge wherever a Meta model is used | — (the badge names the models used elsewhere) | [#5](https://github.com/JuanDaGonz18/convia-hackathon/pull/5) | |
| **Open sign-up and verified institutions**: any e-mail can sign up; institutional domains verify at once, everyone else chooses an institution and verifies it with their student ID. The card's face is matched with the selfie and left out on the device, so only crops without the face are sent; Muse Spark reads them and code decides verified / manual review / retry (never an automatic rejection). Cards without a photo go to manual review with a screenshot of the institutional account. Trips, people and chats stay hidden until the institution is verified | Muse Spark 1.3 | [#6](https://github.com/JuanDaGonz18/convia-hackathon/pull/6) | |
| **Trip assistant** ("Encuentra tu viaje"): the passenger describes the trip in their own words; an agent with a tool allowlist resolves places, searches with the app's matcher and proposes one seat. Code checks the parsed request before searching and the proposal before showing it (live data, numbers, then a judge model); the passenger confirms, bound to a hash of the proposal. Every step is visible in "How the assistant decided" | Muse Spark Open (agent) + Muse Spark 1.3 (judge) | [#7](https://github.com/JuanDaGonz18/convia-hackathon/pull/7) | |

## What existed before the event (not in this repository)

These parts of ConVía were built before the building period. They are **not** part of the submission and their code is not in this repository, but it is public so it can be compared:

- **Base app:** [JuanDaGonz18/ConVia at `cbab924`](https://github.com/JuanDaGonz18/ConVia/tree/cbab924daed05926b46b1798ee10536f6b99184c) (October 24, 2026).
- **Vehicle verification prepared on October 25:** [five commits on the `hackathon/convia-verify` branch of WheelsApp](https://github.com/JuanDaGonz18/WheelsApp/compare/709ca03...hackathon/convia-verify), with their original timestamps. That branch starts from `709ca03`, the commit just before `cbab924` (which only changed the download page, the legal texts and `app.config.js`).

What existed:

- **The base app:** an Expo (React Native) app with a Supabase backend. It covers registration with an institutional e-mail and Microsoft sign-in, trip publishing, route-based matching, requests, QR boarding, chat, ratings, notifications, plans and a web version. Every table is protected with Row Level Security.
- **On-device face verification:** the selfie is turned into a 128-number embedding on the phone (SFace with ONNX Runtime). The photo never leaves the device; only the embedding is sent to ConVía's own database for comparison. No face data is ever sent to Meta or any other third party.
- **Vehicle verification, prepared on October 25, 2026 (two days before the building period):**
  - the `verify-vehicle` Supabase Edge Function, which checks that a photo shows the driver's registered car using SAM 3.1 (finds the car and the license plate) and Muse Spark 1.3 (reads plate, brand, color and photo quality as JSON);
  - `decision.ts`, the logic that compares the model output with the registered vehicle and accepts, rejects or asks for a new photo;
  - the `vehicle_verifications` table, the app's verification step, and its tests.

## Meta models used

Models used by the code in this repository:

| Model | ID | Used for | Where |
| --- | --- | --- | --- |
| SAM 3.1 | `sam-3.1` | Tracking the arriving car ("car") and its plate ("license plate") across the frames of a 3 s clip, with confidence per frame | `supabase/functions/verify-pickup/model.ts` (`segmentVideo`) |
| Muse Spark 1.3 | `muse-spark-1.3` | Reading plate, brand and color from the frame SAM picked, as strict JSON | `supabase/functions/verify-pickup/model.ts` (`readPlate`) |
| Muse Spark 1.3 | `muse-spark-1.3` | Translating the app's Spanish texts into English (batches, strict JSON, placeholders checked) | `scripts/translate-locale.mjs` |
| Muse Spark 1.3 | `muse-spark-1.3` | Proposing brand, line, color and plate from the driver's vehicle photo, strict JSON with a confidence per field | `supabase/functions/suggest-vehicle/` (`suggest.ts`) |
| Muse Spark 1.3 | `muse-spark-1.3` | Reading the student ID crops (never the face) and, for cards without a photo, the card and the institutional-account screenshot, as strict JSON | `supabase/functions/verify-student-id/` |
| Muse Spark Open | `meta-models/muse-spark-open-1026` (Baseten); `meta-models/Muse-Spark-Open-816B-A42B` (Modal, fallback) | The trip assistant: tool calls for places, trip search and the seat proposal | `supabase/functions/match-agent/` (`loop.ts`) |
| Muse Spark 1.3 | `muse-spark-1.3` | Judging every claim in the assistant's proposal against the trip data, strict JSON | `supabase/functions/match-agent/judge.ts` |
| Muse Image 1.0 | `muse-image-1.0` | Generating the three fictional sample cars used in the demo (see below); not called by the app | `hackathon-samples/`, `hackathon-landing/hero-car.jpg` |

### AI-generated sample images

Every car image and clip in `hackathon-samples/` and the landing's `hackathon-landing/hero-car.jpg` was **generated with Meta's Muse Image (`muse-image-1.0`)**. The cars and plates (CNV 026, KTR 418, and one with the plate covered) are **fictional**; no real vehicle or person is shown. The 3 s clips were made from those still images so the judges can run the real verify-pickup pipeline without filming a real car. The landing page labels the hero image the same way.

## Privacy decisions

- **Faces never leave the phone** (pre-existing): only a 128-number embedding goes to ConVía's own database. No face data is ever sent to Meta.
- **Pickup clips are never kept.** The clip goes to SAM 3.1 inline, so it is never stored at the model provider. The clip and its frames are deleted from ConVía's storage after every check, whatever the outcome. Only the result is stored: reason code, plate read, timings.
- **No "person" segmentation.** We considered running SAM 3.1 with the prompt "person" to make sure no image of people is kept. Since no image is kept at all, it would add cost (one more prompt over every frame, about $0.02 per check) without protecting anyone further. If clips or frames are ever stored, for example to resolve a dispute, people must be blurred first.
- **The full plate and the driver's phone** are only given to the accepted passenger of an active trip.
- **The student ID's face never leaves the device.** It is matched with the user's selfie on the phone or in the browser and left out: only crops without the face go to Muse Spark. Only the result is stored.
- **The assistant's trace masks phones and full plates** before it is stored, and the assistant only reads trips the user could already see in the app (same verified institution).
- **Never accuse on a doubt.** "Don't get in" requires a confident reading: another plate, or the right plate on a car of a clearly different brand or color. Colors that light can change into each other (gray, silver, dark blue, black…) are never treated as different. Anything uncertain asks the passenger to film again.

## Pre-existing code it depends on

The new code may call modules that existed in ConVía before the event. They are not included here. [EXTERNAL_DEPENDENCIES.md](EXTERNAL_DEPENDENCIES.md) is generated from the imports in this repository, and lists every such module and which new file uses it.

## How to review

1. Read the PRs in order. Each one says what was built, which Meta model it uses and how to test it.
2. Paths are the same as in ConVía. For example, a file under `supabase/functions/` is a Supabase Edge Function, and one under `app/` is a screen.
3. The code runs inside ConVía, not on its own. To see it working, use the live app or the demo video above.

## License

[MIT](LICENSE).
