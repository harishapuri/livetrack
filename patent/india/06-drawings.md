# Drawings

**DRAFT.** These sheets explain Figures 1 to 7 of the complete specification. They are black-and-white drafting figures, not the Patent Office’s final sheet format. A draughtsman should place each figure on the prescribed sheet, with margins, a figure number, and lead lines if the Office requires numerals outside the boxes. Do not add colour, shading, or photographs.

Reference numerals match Form 2.

| Numeral | Part |
| --- | --- |
| 10 | Process-execution system (the arrangement on computer 11) |
| 11 | Computer |
| 12 | Desktop controller |
| 14 | Queue store |
| 15 | Operator |
| 16 | Queue card |
| 18 | Step |
| 20 | Step cursor |
| 22 | Run state |
| 24 | Browser |
| 26 | Browser extension |
| 28 | Electronic form |
| 30 | Live control |
| 32 | Loopback bridge |
| 33 | Capture channel |
| 34 | Matcher |
| 36 | Capture unit |
| 38 | Repair unit |
| 40 | Recorder |
| 42 | Draft procedure |
| 44 | Approval gate |
| 46 | Learned-choice store |
| 50 | Hello message |
| 51 | Ping and pong |
| 52 | Run-card message |
| 53 | Watch-card message |
| 54 | Apply-step message |
| 55 | Control message |
| 56 | Step-update message |
| 57 | Repair-plan message |
| 58 | Value-check message |
| 60–70 | Apply-step blocks in Figure 5 |
| 72 | Idle |
| 74 | Running |
| 76 | Paused |
| 78 | Resume at the first incomplete step |
| 80–84 | Repair blocks in Figure 6 |
| 90–96 | Record-and-approve blocks in Figure 7 |

## Sheets

- [drawings/fig-1-system.svg](drawings/fig-1-system.svg) — system on one computer: controller, queue store, loopback bridge, browser extension, form, recorder, and approval gate.
- [drawings/fig-2-bridge.svg](drawings/fig-2-bridge.svg) — loopback bridge, message names, shorthand normalisation, and the capture channel.
- [drawings/fig-3-state.svg](drawings/fig-3-state.svg) — idle, running, and paused, and resume at the first incomplete step.
- [drawings/fig-4-step-match.svg](drawings/fig-4-step-match.svg) — discard weak hints, score distinctive hints, withhold a completion mark.
- [drawings/fig-5-apply-step.svg](drawings/fig-5-apply-step.svg) — visibility test, pause wait, bind, write, and step update.
- [drawings/fig-6-repair.svg](drawings/fig-6-repair.svg) — capture and repair of one failed step.
- [drawings/fig-7-record-to-card.svg](drawings/fig-7-record-to-card.svg) — unmatched work held as a draft until approval creates a queue card.

Learned-choice store 46 is on Figure 1. Its write-and-merge behaviour is in the description at paragraphs [0039] and [0046]. It does not have a separate flow sheet.
