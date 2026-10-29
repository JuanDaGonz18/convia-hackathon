# Demo sample cars (AI-generated)

Every image and clip in this folder was **generated with Meta's Muse Image (`muse-image-1.0`)**. The cars and plates are **fictional**; no real vehicle or person is shown.

| Folder | Car | What verify-pickup should answer |
| --- | --- | --- |
| `match/` | The demo trip's car, plate CNV 026 | It's your ride |
| `other/` | Another car, plate KTR 418 | Don't get in |
| `covered/` | The plate is covered | Film again |

Each folder holds a 3 s clip made from the still image (`<name>.png`), the frames the app would extract every 0.5 s, and `frames.json` listing them. They are uploaded to a private Storage bucket (`pickup-samples`) so demo accounts can run the real SAM 3.1 + Muse Spark pipeline without filming a car. `vehicle.jpg` is the demo driver's vehicle photo (also the landing page's hero image).
