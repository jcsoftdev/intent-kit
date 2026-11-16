# Changelog

## 0.2.1

- Every package is now proprietary: the license changes from MIT to all rights reserved (`UNLICENSED`). Versions 0.1.0 and 0.2.0 were published under MIT.

## 0.2.0

- Add `@jcsoftdev/intent-dom`, `@jcsoftdev/intent-voice-web`, `@jcsoftdev/intent-react`, `@jcsoftdev/intent-next` and `@jcsoftdev/intent-ui`.
- Add `IntentSession.capture` so a client can enter the capturing state before a command is submitted.
- Patterns accept a number slot between two text slots (`mesa {table} {quantity?} {dish}`), treat `,` `;` `.` between slots as whitespace, and `@jcsoftdev/intent-server` exports `foldSpanishPlural`.
- Every package moves to 0.2.0 in lockstep.

## 0.1.0

- First release of `@jcsoftdev/intent-core`, `@jcsoftdev/intent-server`, `@jcsoftdev/intent-zod` and `@jcsoftdev/intent-testing`.
