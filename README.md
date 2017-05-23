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
### Sample bot

Use the static methods of `SpeechDialog` to prompt the caller to either `understandSpeech()` (speech-to-text and LUIS) or `recognizeSpeech()` (just speech-to-text). These methods extend the functionality of the built in [Prompts](recognizeSpeech) class.

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

### Automatic Intent-to-Dialog mapping
Use a `LuisDialog` instance and its `triggerAction()` method to automatically call a dialog when a certain intent is recognized by LUIS.
```TypeScript
import { IUnderstandRecording, LuisDialog } from 'botbuilder-calling-speech';

bot.dialog('myIntentDialog', new LuisDialog([
  (session, args: IUnderstandRecording, next) => {
    session.endDialog('Your order is shipping soon!');
  },
]).triggerAction({
  match: 'intent.order.status',
  threshold: 0.8, // optional
}));
```

> **Note** Automatic dialog mapping only occurs for prompts initiated by `SpeechDialog.understandSpeech()`.

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

### SpeechDialog

#### Methods
* (static) **recognizeSpeech(session, playPrompt, options)**: Prompt caller and process speech through the configured `SpeechClient`.
  - *session*: a `CallSession` object
  - *playPrompt*: typically a `string`. May be any prompt recognized by   -Prompts.record()` from `botbuilder-calling`
  - *options*: (optional) `IRecordPromptOptions` object from `botbuilder-calling`
* (static) **understandSpeech(session, playPrompt, options)**: Prompt caller and process speech through both the configured `SpeechClient` and `LuisClient`.
  - *session*: a `CallSession` object
  - *playPrompt*: typically a `string`. May be any prompt recognized by   - rompts.record()` from `botbuilder-calling`
  - *options*: (optional) `IRecordPromptOptions` object from `botbuilder-calling`

### LuisDialog

Wrap a dialog around a specific LUIS intent

#### Constructor
* **new LuisDialog(dialog)**: Create a new instance
  - *dialog*: any valid `Dialog|IDialogWaterfallStep[]|IDialogWaterfallStep` that will handle the intent

#### Methods
* **triggerAction(options)**: assign a named intent and optional confidence threshold to this LuisDialog
  - *options.match*: (string) name of the LUIS intent to match
  - *options.threshold*: (number) optional threshold required to trigger this dialog
  - *returns* the current LuisDialog
