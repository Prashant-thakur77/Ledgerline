# The video plan: Chatterbox voiceover + one-take screen

Audio is generated locally (Chatterbox TTS, adam.mp3 voice), so the screen recording has no
sync pressure: record once while the finished WAV plays in headphones, merge with ffmpeg.

## Flow
1. Paste the CHUNKS list and loop into voiceover.py (chunks + per-chunk exaggeration/cfg are
   in the conversation with Claude; also summarized below). Generate, listen, regenerate any
   single chunk that sounds off.
2. Tabs in order: /app · / · /docs · /app/activity · /app/lend · /roadmap · /confidential · /security
3. Wallet unlocked on Coston2, funded; practice the attestation once.
4. One screen take following the cue sheet; the attestation starts in chunk 2 (~0:35) and has
   landed by chunk 8 (~3:45).
5. ffmpeg -i screen.mp4 -i voiceover_final.wav -map 0:v -map 1:a -c:v copy -shortest proofline_demo.mp4

## Cue sheet
| Chunk | Time | Screen | Voice mood (exaggeration / cfg) |
|---|---|---|---|
| 1 open | 0:00 | landing hero to proof card | warm fire (0.65 / 0.35) |
| 2 go live | 0:30 | app: connect, Yours, Run attestation | confident (0.5 / 0.5) |
| 3 underwriting | 1:05 | docs, Underwriting section | precise (0.5 / 0.45) |
| 4 two ledgers | 1:35 | activity: Both ledgers, 115 XRP row | wonder (0.55 / 0.45) |
| 5 lockbox | 2:10 | lend, then roadmap Phase A cards | proud (0.6 / 0.4) |
| 6 confidential | 2:45 | confidential evidence table | hushed awe (0.6 / 0.35) |
| 7 security | 3:20 | security findings lattice | grave (0.45 / 0.4) |
| 8 landing | 3:45 | back to app: the proven period | rising close (0.7 / 0.3) |

If a take fumbles: re-record the screen only; the audio never changes.
