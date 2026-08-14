# The video plan: picture first, audio fitted after

Workflow: record each shot as its own clip, edit the cut, then hand Claude the actual scene
durations. The Chatterbox voiceover is generated last, chunk by chunk, sized to the cut at
about 2.4 words per second, so the audio fits the picture instead of the reverse.

Target assembled length: about 3:50 to 4:10.

---

## Prep, once, before any recording

1. **Wallet.** MetaMask unlocked. Get 5 to 10 C2FLR from https://faucet.flare.network
   (choose Coston2 / C2FLR).
2. **Force the connect prompt onto camera.** In the app header click *disconnect*, then in
   MetaMask open the menu, *Connected sites*, and disconnect `ledgerline-flare.vercel.app`.
   Now S3 will show the real popup.
3. **Practice run.** Do one full attestation off camera (connect, Yours, Run an attestation).
   Learn the rhythm: **MetaMask pops TWICE**. Once at the start (pays the FDC fee), and once
   about 2.5 minutes later (stores the proof on chain). Knowing the second popup is coming is
   the difference between a clean S5 and a fumbled one. Then disconnect again (step 2) so S3
   is fresh.
4. **Browser.** 1920x1080 window, 100% zoom, bookmarks bar hidden (Ctrl+Shift+B). Only these
   tabs, in this order:
   `/` · `/app` · `/docs` · `/app/activity` · `/app/lend` · `/roadmap` · `/confidential` · `/security`
5. **Recorder.** Capture that window, 30fps is fine. One file per shot: `S1.mp4`, `S2.mp4`, ...

**Recording rules.** Hold still 1 second at the start and 2 seconds at the end of every clip
(trim handles). The cursor is a pointer for the narration: move it deliberately to the thing
the voice will name, then stop. No circling, no waving. Record longer than the target; cut
down in the edit.

---

## Shot by shot

### S1 · The hero (record ~25s, target 12s)
1. Tab `/`, page loaded. Mouse parked at the screen edge. Record. Hold still 2s while the
   terrain rolls.
2. Glide the mouse **into the terrain** below the headline; drift slowly left to right once.
   The surface swells under it and the crimson tide sweeps. 4 to 5s.
3. Scroll down slowly past the marquee until **NOT A MOCK** with the dollar figure fills the
   screen. Stop. Hold 3s. Cut.

### S2 · The proof card (~20s, target 10s)
1. Same position. Record. Move the cursor **onto the big card**; it tilts toward you. One
   small slow circle so the tilt reads. 3s.
2. Rest the cursor on the **green line** under the figure. Hold 2s.
3. Click the **↗** at the end of the green line. The explorer opens in a new tab: hold on the
   transaction 4s. Close that tab. Cut.

### S3 · Connect (~30s, target 12s)
1. Tab `/app`. You are disconnected (prep step 2). Record. Hold 1s.
2. Click **Connect wallet**. MetaMask pops: account select, then **Connect**. If it asks to
   add or switch to **Coston2**, approve that too. That prompt is a feature; let it be seen.
3. The page re-renders connected: your address in the header, Coston2 shown. Hold 3s. Cut.

### S4 · Start the attestation (~40s, target 15s)
1. Still on `/app`. Record. Under **Whose revenue**, click **Yours**. The page switches to
   your account (empty history is correct). 2s.
2. Scroll to **Prove a period**. Click **Run an attestation**.
3. MetaMask pops (the FDC fee). Move deliberately. Click **Confirm**.
4. The console starts narrating. **Do not cut yet.** Wait until it prints the voting round
   number with its link. Hold on that line 3s. Cut, or roll straight into S5.

### S5 · The wait and the landing (record the FULL ~3 minutes, one clip; target ~20s cut)
1. Keep recording from S4, or start a new clip immediately. **Do not switch tabs in this
   window.**
2. Let the console work: rounds counting up, then the Merkle root printing, then
   *retrieving proof*.
3. **About 2.5 minutes in, MetaMask pops a SECOND time** (storing the proof). Confirm it.
   This moment is gold; do not miss it by walking away.
4. The console prints the stored transaction, and above it the **new period appears with its
   green proof line**. Rest the cursor on the green line. Hold 5s. Cut.

You will jump-cut the middle wait in the edit. The landing footage doubles as S13.

### S6 · Underwriting (~25s, target 12s)
1. Tab `/docs`. Record at the top: **HOW IT WORKS.** 2s.
2. Click **02 · Underwriting** in the contents list; it jumps. Scroll slowly through the 2.5%
   base paragraph, then the **"And it underwrites the way acquirers do"** paragraph (age
   haircut, rolling reserve, lockbox). Stop there. Hold 3s. Cut.

### S7 · Both ledgers (~25s, target 12s)
1. Tab `/app/activity`. Record on the hero: **EVERY MOVE, ON CHAIN.** 2s. Scroll to
   **Both ledgers, right now**.
2. Point at the **Lender pool, on Flare** row, stop 2s. Move down to the **Repayment
   treasury, on the XRP Ledger** row, the 115 XRP. Stop 3s. Cut.

### S8 · The feed (~20s, target 8s)
1. Same tab. Scroll to the feed. Slow-scroll the rows once.
2. Rest on a **green row** ("Revenue proven ...") 2s. If a row has *"on the XRP Ledger ↗"*,
   click it, hold 3s on the XRPL explorer, close. Cut.

### S9 · Lend (~20s, target 10s)
1. Tab `/app/lend`. Record on **FUND THE ADVANCES.** 2s.
2. Scroll to the three pool figures. Point at **Pool holds**, then **Available to lend**. 4s.
3. Continue to the bold disclosures (**you carry XRP/USD drift** / **dips the share price**).
   Hold 3s. Cut.

### S10 · Roadmap (~30s, target 14s)
1. Tab `/roadmap`. Record on **NOTHING HERE IS INVENTED.** 3s.
2. Scroll to **Phase A · live on Coston2 now**. Move the cursor onto the **Deduction at
   source** card; it inverts to white. Hold 2s.
3. Move to **The rolling reserve** card, hover, then click its **live evidence ↗**. Hold 3s
   on the explorer transaction. Close. Cut.

### S11 · Confidential (~30s, target 15s)
1. Tab `/confidential`. Record on **PROVEN, NOT PUBLISHED.** 3s.
2. Scroll to the evidence table. Point at **Went in, $3,916.78**, then **Came out, limit
   $97.91**. 4s.
3. Point at **"And with the key in the enclave, on 66184."** Hold 2s.
4. Scroll to **Three trust models, one answer**, the live green decision block. Hold 3s. Cut.

### S12 · Security (~25s, target 12s)
1. Tab `/security`. Record on **WE ATTACKED OUR OWN PRODUCT.** 3s.
2. Scroll to the six findings. Hover one card (it inverts). Read-pace scroll through the
   grid. Hold 2s. Cut.

### S13 · The landed proof (target 10s)
Already recorded: it is the last 15 seconds of S5. In the edit, place it here.

### S14 · Close (~15s, target 8s)
1. Tab `/`. Scroll to top. Record. One slow mouse pass through the terrain.
2. Park the cursor bottom-right, off the text. Hold on **PROVE REVENUE. BORROW AGAINST IT.**
   for 5s. Cut.

---

## Recovery rules

A fumbled shot = re-record that clip only. Exception: S3, S4, S5 are one wallet session. To
redo them, disconnect and revoke in MetaMask (prep step 2); the attestation will simply prove
a new period, which is fine and arguably better. MetaMask covering the page mid-shot: keep
rolling, it is honest.

## Edit order

S1 S2 S3 S4 S5(start) S6 S7 S8 S9 S10 S11 S12 S13(=S5 landing) S14.

## After the cut

Send Claude the real per-scene durations (a list like `S1 11s, S2 9s, ...` is enough). The
voiceover chunks get written to those exact windows, with per-chunk Chatterbox emotion
settings (exaggeration and cfg_weight), and generated as `chunk_N.wav` files that drop onto
the timeline scene by scene.
