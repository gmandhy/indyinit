# iTap Figma integration

Source: https://www.figma.com/design/0K7kXKo1wmDAaEDzerQL0s/iTap

Screens: Home `4:1433`, Exercises `15:3085`, Session `10:402`, Progress `15:2302`.

`src/components/workstation/Workspace.tsx` implements the presentation with ordinary React and CSS. `src/app/App.tsx` owns page navigation, manual routine state, and the bounded in-memory history. The same `useSessionController` hook owns hardware; components do not implement sensing or DSP. Existing controls, viewport, diagnostics, and export panels are composed into the workstation. Engine algorithms and calibration thresholds were not modified.

The supplied Figma asset URLs were downloaded to `public/figma/`. The source design includes composite images clipped into illustration slots; the implementation preserves those source-image dimensions and offsets for the botanical banner and routine images. These are design assets, not screenshots of the implemented website. No expiring Figma URLs are used at runtime. SVGs retain their intrinsic dimensions.

Intentional data adaptations:

- The design's historic results are replaced by measured trials and honest empty states.
- Finger PIP range is labeled as an estimate, never substituted for a wrist angle. Synthetic replay is filtered separately from live trials. Sensor modes are separated.
- The illustrated routine is manual practice with self-reported completion. Pause applies to that routine; timed sensor trials retain the existing abort/recalibration contract.
- Check-in scheduling, clinical targets, pain measurements, authentication, and cloud persistence are not implemented or implied by decorative controls.
- Session navigation stops active devices. Compact workstation layout changes preserve the current session.

Testing handoff: the user requested UI work first and will conduct deeper testing afterwards. Check routine navigation/repetitions, source selection, all three tracked modes, calibration, export, reset, history filters, narrow screens, and device cleanup. The pre-existing live palm-calibration issue and tap/noise acceptance procedure are documented in `progress.md`; this UI change does not resolve or certify those hardware gates.
