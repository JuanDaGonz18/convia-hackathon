# ConVía — Meta Global AI Developer Hackathon extract

This repository is an **extract**: it contains **only the code written during the Meta Global AI Developer Hackathon** (building period: from the end of the kickoff session on **October 26, 2026** to **November 4, 2026**). Nothing that existed before the event is included.

The new code is part of **ConVía**, a carpooling app for university students and staff in Chía and the Sabana area (Colombia). ConVía was developed before the event in a separate repository. Here, every file keeps the path it has inside ConVía, so its location shows where it plugs into the app. Where the new code calls existing ConVía code, that code is listed as an external dependency (see [Pre-existing code it depends on](#pre-existing-code-it-depends-on)), not copied.

- **Daily log:** [HACKATHON_LOG.md](HACKATHON_LOG.md)
- **Every change lands through a pull request** that states what was built, which Meta model it uses and how to test it.

## Demo

<!-- Replace with the final links. -->
- Video: _coming soon_
- Live app: _coming soon_

## Built during the hackathon

| Feature | Meta model | PR | Demo timestamp |
| --- | --- | --- | --- |
| **Pickup check** ("Verificar mi carro"): the passenger films the arriving car for 5 s; SAM tracks the car and its plate across frames and Muse Spark reads the plate from the best frame, then code decides: it's your ride / don't get in / film again | SAM 3.1 + Muse Spark 1.3 | [#1](https://github.com/JuanDaGonz18/convia-hackathon/pull/1) | |
| **Spanish / English**: i18next with a language picker (Sistema / Español / English); the English texts are generated from the Spanish ones by a script that sends them to Muse Spark in batches, checks every key and {{placeholder}}, and never overwrites reviewed text | Muse Spark 1.3 | [#2](https://github.com/JuanDaGonz18/convia-hackathon/pull/2) | |
| **"Remember me" and password recovery**: keep the session or end it with the tab/app; reset link by e-mail and a new-password screen | — | [#2](https://github.com/JuanDaGonz18/convia-hackathon/pull/2) | |

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
| SAM 3.1 | `sam-3.1` | Tracking the arriving car ("car") and its plate ("license plate") across the frames of a 5 s clip, with confidence per frame | `supabase/functions/verify-pickup/model.ts` (`segmentVideo`) |
| Muse Spark 1.3 | `muse-spark-1.3` | Reading plate, brand and color from the frame SAM picked, as strict JSON | `supabase/functions/verify-pickup/model.ts` (`readPlate`) |
| Muse Spark 1.3 | `muse-spark-1.3` | Translating the app's Spanish texts into English (batches, strict JSON, placeholders checked) | `scripts/translate-locale.mjs` |

## Privacy decisions

- **Faces never leave the phone** (pre-existing): only a 128-number embedding goes to ConVía's own database. No face data is ever sent to Meta.
- **Pickup clips are never kept.** The clip goes to SAM 3.1 inline, so it is never stored at the model provider. The clip and its frames are deleted from ConVía's storage after every check, whatever the outcome. Only the result is stored: reason code, plate read, timings.
- **No "person" segmentation.** We considered running SAM 3.1 with the prompt "person" to make sure no image of people is kept. Since no image is kept at all, it would add cost (one more prompt over every frame, about $0.02 per check) without protecting anyone further. If clips or frames are ever stored, for example to resolve a dispute, people must be blurred first.
- **The full plate and the driver's phone** are only given to the accepted passenger of an active trip.
- **Never accuse on a doubt.** "Don't get in" requires a confident reading: another plate, or the right plate on a car of a clearly different brand or color. Colors that light can change into each other (gray, silver, dark blue, black…) are never treated as different. Anything uncertain asks the passenger to film again.

## Pre-existing code it depends on

The new code may call modules that existed in ConVía before the event. They are not included here. [EXTERNAL_DEPENDENCIES.md](EXTERNAL_DEPENDENCIES.md) is generated from the imports in this repository, and lists every such module and which new file uses it.

## How to review

1. Read the PRs in order. Each one says what was built, which Meta model it uses and how to test it.
2. Paths are the same as in ConVía. For example, a file under `supabase/functions/` is a Supabase Edge Function, and one under `app/` is a screen.
3. The code runs inside ConVía, not on its own. To see it working, use the live app or the demo video above.

## License

[MIT](LICENSE).
