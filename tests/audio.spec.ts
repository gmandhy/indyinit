import { test, expect } from '@playwright/test';

// A real Web Audio graph supplies synthetic PCM to the production microphone adapter.
// This verifies worklet loading/clock mapping, not microphone or physical-tap accuracy.
test('production microphone worklet calibrates and detects an impulse without camera', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    let context: AudioContext;
    let destination: MediaStreamAudioDestinationNode;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async (constraints: MediaStreamConstraints) => {
      if (!constraints.audio || constraints.video) throw new Error('Expected independent microphone request');
      context = new AudioContext();
      await context.resume();
      destination = context.createMediaStreamDestination();
      // Keep the stream alive, with a quiet background followed by an operator-triggered burst.
      const quiet = context.createConstantSource();
      quiet.offset.value = 0;
      quiet.connect(destination);
      quiet.start();
      return destination.stream;
    } });
    Object.assign(window, { testTap: () => {
      const source = context.createBufferSource();
      const buffer = context.createBuffer(1, Math.round(context.sampleRate * .004), context.sampleRate);
      buffer.getChannelData(0).fill(.3);
      source.buffer = buffer;
      source.connect(destination);
      source.start();
    } });
  });
  await page.goto('/#session');
  await page.getByRole('button', { name: 'Set up desk taps', exact: true }).click();
  await page.getByText('Advanced desk controls',{exact:true}).click();
  await expect(page.getByRole('combobox', { name: 'Exercise', exact: true })).toHaveValue('desk_tap:fused');
  await page.getByRole('button', { name: 'Start / retry microphone (keep quiet)', exact: true }).click();
  const status = page.locator('section[aria-labelledby="status"]');
  await expect(status).toContainText('Microphone: ready', { timeout: 10000 });
  await page.evaluate(() => (window as unknown as { testTap(): void }).testTap());
  await expect(page.getByLabel('Detected tap sounds', { exact: true })).toHaveText('1');
  await expect(page.getByLabel('Recognized table taps', { exact: true })).toHaveText('0');
  await expect(page.getByLabel('Last tap location', { exact: true })).toHaveText('Not measured yet');
  await expect(page.getByRole('meter', { name: 'Microphone level' })).toBeVisible();
  await expect(status).toContainText('Microphone: ready');
  const panel=page.getByRole('region',{name:'Table tap recognition'});
  await panel.screenshot({path:testInfo.outputPath('desk-audio-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  await expect(panel).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await panel.screenshot({path:testInfo.outputPath('desk-audio-narrow.png')});
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(status).toContainText('Microphone: not_started');
});
