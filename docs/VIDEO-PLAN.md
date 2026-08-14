# The video plan: picture first, audio fitted after

Workflow: record each shot as its own clip, edit the cut, then hand Claude the actual scene
durations. The Chatterbox voiceover is generated last, chunk by chunk, sized to the cut
(about 2.4 words per second), so the audio fits the picture instead of the reverse.

## Recording rules
One clip per shot (S1.mp4, S2.mp4, ...). Hold still 1s at the start and 2s at the end of
every clip as trim handles. Cursor points at what the narration will name, then stops.
1920x1080, 100% zoom, bookmarks hidden. Record longer than the target; cut down in the edit.

## Shot list
| # | Where | Action | Target | Record |
|---|---|---|---|---|
| S1 | / | terrain rolls, mouse into it, scroll to proof card | 12s | 25s |
| S2 | proof card | hover (tilt), rest on green line, click the explorer link, hold | 10s | 20s |
| S3 | /app | Connect wallet, MetaMask approve, Coston2 visible | 12s | 30s |
| S4 | /app | toggle Yours, Run an attestation, confirm, console starts | 15s | 40s |
| S5 | /app console | ONE clip, full ~3 min: rounds, Merkle root, stored, new period lands | 20s cut | full |
| S6 | /docs | scroll 02 Policy, the underwriting paragraphs | 12s | 25s |
| S7 | /app/activity | Both ledgers block: pool row, then the 115 XRP treasury row | 12s | 25s |
| S8 | /app/activity | scroll feed, hover a green attested row | 8s | 20s |
| S9 | /app/lend | pool figures, scroll to the two disclosures | 10s | 20s |
| S10 | /roadmap | hero, Phase A cards, hover an inversion, click live evidence, hold | 14s | 30s |
| S11 | /confidential | hero, evidence table, the $97.91 rows, key-in-enclave row | 15s | 30s |
| S12 | /security | hero, six findings, hover an inversion | 12s | 25s |
| S13 | /app | the landed period from S5: figure, green proof line, click through | 10s | 20s |
| S14 | / | closing hero pass, hold on the headline | 8s | 15s |

Assembled target: about 3:50 to 4:10. Edit order = table order; S5's landing footage is S13.
S3, S4, S5 are one wallet session; everything else records in any order. Practice the
attestation once first; the wallet needs 5 to 10 C2FLR from faucet.flare.network.

## After the cut
Send Claude the real per-scene durations. The voiceover chunks (with per-chunk emotion
settings for Chatterbox) get written to those windows and generated as chunk_N.wav files
that drop onto the timeline scene by scene.
