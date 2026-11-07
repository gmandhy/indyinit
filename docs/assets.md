# Local asset provenance — phase 1

Recorded 2026-11-07. `assets-manifest.json` records every source, local destination, and SHA-256 checksum. `package-lock.json` additionally records the npm tarball integrity. Checksums were computed from downloaded source bytes, not placeholders. Preparation never rewrites the manifest or accepts changed hashes automatically.

| Asset | Source/version | License evidence |
| --- | --- | --- |
| Two JS loaders and two WASM binaries | Installed `@mediapipe/tasks-vision@1.2.2`, `wasm/`; exact npm tarball URL in manifest | Installed package metadata: `Apache-2.0`; loader source copyright notices retained |
| `hand_landmarker.task` | Google `mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task` | [Google-linked Hand Tracking model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20%28Lite_Full%29%20with%20Fairness%20Oct%202021.pdf), page 2: Apache License, Version 2.0 |
| `mediapipe/LICENSE-2.0.txt` | [Canonical Apache 2.0 text](https://www.apache.org/licenses/LICENSE-2.0.txt) | License text included locally and copied to production output |

The [official Hand Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker) links the full float16 model bundle and its model card. The bundle contains palm detection and landmark models. Its versioned `/1/` URL is pinned rather than the guide's `latest` alias. Model and SDK releases have separate version schemes; this is the selected pair, not proof that GPU/CPU inference has run on this laptop. That hardware compatibility check belongs to phase 3.

```sh
npm ci
npm run assets:prepare
npm run assets:verify
npm run build
```

Preparation fetches only model/license URLs, copies WASM from the locked installed package, validates each hash before writing, and checks local hashes afterward. Verification needs no network. Binary downloads are intentionally not checked into Git. After preparation, dev/production serving and asset verification require no remote CDN. A future asset upgrade must deliberately change the package version/lockfile, review upstream model/license sources, and replace reviewed manifest hashes together.

Expected runtime locations: `/mediapipe/wasm` for `FilesetResolver` and `/models/hand_landmarker.task` for the model. Host the app at the origin root with these paths in future deployments. No model loader is instantiated in phase 1. Both the build and browser preflight fail explicitly on missing or modified assets; replay can still run as a labeled synthetic transport fixture.
