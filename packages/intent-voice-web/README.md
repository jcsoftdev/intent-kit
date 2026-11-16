# @jcsoftdev/intent-voice-web

Push-to-talk speech source for the intent kit over the Web Speech API. Part of the [intent kit](../../README.md).

## Install

```sh
pnpm add @jcsoftdev/intent-voice-web @jcsoftdev/intent-core
```

## Usage

```ts
import { createWebSpeechSource, needsCloudNotice } from '@jcsoftdev/intent-voice-web';

const speech = createWebSpeechSource({ preferLocal: true });
const mode = await speech.privacyMode('es-PE', { signal });
```

`start()` is push-to-talk: it streams partials and resolves with the final transcript after `stop()` (button released) or when the engine ends. `processLocally` is set only when `SpeechRecognition.available({ langs, processLocally: true })` returns `available`; otherwise the mode is `cloud` and `needsCloudNotice(mode, store)` tells the host to show the first-use notice. The package never calls `install()`: downloading language packs needs a user gesture and is the host's decision.

Web Speech surface checked against MDN on 2026-11-12: static `SpeechRecognition.available({ langs, quality, processLocally })` resolving `available`, `downloading`, `downloadable` or `unavailable`; `SpeechRecognition.install(...)`; instance `processLocally`. Chrome ships it from 139; browsers without `available()` are treated as `cloud`.

## License

Proprietary. Copyright © 2026 jcsoftdev. All rights reserved. See [LICENSE](./LICENSE).
