# Installation
```
npm install --save botbuilder-calling-speech
```

## Peer dependencies
```
npm install --save botbuilder-calling cognitive-speech-client cognitive-luis-client
```

# Usage

## TypeScript
```TypeScript
import { SpeechDialog, speechLibrary } from 'botbuilder-calling-speech';
import { UniversalCallBot } from 'botbuilder-calling';
import { SpeechAuthClient, SpeechClient, SpeechResult } from 'cognitive-speech-client';
import { LuisClient, LuisResult } from 'cognitive-luis-client';

// your bot
const bot = new UniversalCallBot(/* params */);

// cognitive apis
const speechClient = new SpeechClient(new SpeechAuthClient('key'));
const luisClient = new LuisClient('appId', 'key');

// attach attach speech library to your bot
bot.library(speechLibrary(speechClient, luisClient));

// use SpeechDialog to prompt for a recording and process it
bot.dialog('/', [
  (session: CallSession, args, next) => {

    // speech-to-text and language understanding
    SpeechDialog.understandSpeech(session, 'Where do you want to go today?');

    // just speech-to-text
    // SpeechDialog.recognizeSpeech(session, 'Where do you want to go today?');
  },
  (session: CallSession, args, next) => {
    if (args.error) {
      console.error(args.err);
      return session.error(args.error);
    }

    const speech: SpeechResult = args.response.speech;
    const luis: LuisResult = args.response.language;

    session.endDialog(`You said ${speech.header.name}, with intent ${luis.topScoringIntent.intent} and ${luis.entities.length} entities`);
  },
]);
```

## JavaScript
```JavaScript
const bcs = require('botbuilder-calling-speech');
const bc = require('botbuilder-calling');
const csc = require('cognitive-speech-client');
const clc = require('cognitive-luis-client');

// your bot
const bot = new bc.UniversalCallBot(/* params */);

// cognitive apis
const speechClient = new csc.SpeechClient(new SpeechAuthClient('key'));
const luisClient = new clc.LuisClient('appId', 'key');

// attach attach speech library to your bot
bot.library(bcs.speechLibrary(speechClient, luisClient));

// see TypeScript section for examples of bcs.SpeechDialog prompts
```

## API

Use the static `SpeechDialog` functions just like you would use the static `Prompt` functions from `botbuilder-calling`.

### SpeechDialog.recognizeSpeech(session, playPrompt, options)

Prompt caller and process speech through the configured `SpeechClient`.

* **session**: a `CallSession` object
* **playPrompt**: typically a `string`. May be any prompt recognized by `Prompts.record()` from `botbuilder-calling`
* **options**: (optional) `IRecordPromptOptions` object from `botbuilder-calling`

### SpeechDialog.understandSpeech(session, playPrompt, options)

Prompt caller and process speech through both the configured `SpeechClient` and `LuisClient`.

* **session**: a `CallSession` object
* **playPrompt**: typically a `string`. May be any prompt recognized by `Prompts.record()` from `botbuilder-calling`
* **options**: (optional) `IRecordPromptOptions` object from `botbuilder-calling`
