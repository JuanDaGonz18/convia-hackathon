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

### October 27, 2026

### October 28, 2026

### October 29, 2026

### October 30, 2026

### October 31, 2026

### November 1, 2026

### November 2, 2026

### November 3, 2026

### November 4, 2026
