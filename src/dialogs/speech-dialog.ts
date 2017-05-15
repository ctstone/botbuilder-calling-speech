import {
  CallSession, Dialog, IAction,
  IConversationResult, IDialogResult, IIsAction,
  IPromptOptions, IRecording, IRecordOutcome,
  IRecordPromptOptions, Library, PlayPromptAction,
  Prompts, RecordAction, RecordingCompletionReason,
  ResumeReason } from 'botbuilder-calling';
import { LuisClient, LuisResult } from 'cognitive-luis-client';
import { SPEECH_PROPERTY, SPEECH_STATUS, SpeechClient, SpeechResult } from 'cognitive-speech-client';
import { RecognizeSpeechAction } from '../workflow/recognize-speech-action';
import { UnderstandSpeechAction } from '../workflow/understand-speech-action';
import { LuisDialog } from './luis-dialog';

export type PlayPrompt = string|string[]|IAction|IIsAction;

export enum PromptType { action, confirm, choice, digits, record, speechToText, understanding, understandingChoice }

enum PromptResponseState { completed, retry, canceled, terminated, failed }

export interface IPromptArgs {
  promptType: PromptType;
  action: IAction;
  maxRetries: number;
}

interface OperationResult {
  state: PromptResponseState;
  retryPrompt: PlayPrompt;
  response: IUnderstandRecording;
}

export interface ISpeechRecording extends IRecording {
  speech: SpeechResult;
}

export interface IUnderstandRecording extends ISpeechRecording {
  language: LuisResult;
  intercepted: boolean;
  choice: IChoice;
}

// tslint:disable-next-line:no-empty-interface
export interface ISpeechResult extends IDialogResult<ISpeechRecording> {
}

// tslint:disable-next-line:no-empty-interface
export interface IUnderstandResult extends IDialogResult<IUnderstandRecording> {
}

export interface IPromptsSettings {
  recognizeSilencePrompt?: PlayPrompt;
  invalidDtmfPrompt?: PlayPrompt;
  invalidRecognizePrompt?: PlayPrompt;
  recordSilencePrompt?: PlayPrompt;
  maxRecordingPrompt?: PlayPrompt;
  invalidRecordingPrompt?: PlayPrompt;
  noSpeech?: PlayPrompt;
}

export interface IChoice {
  name: string;
  variants: string[];
}

export interface IRecordChoiceOptions extends IRecordPromptOptions {
  choices: IChoice[];
}

const DEFAULT_PROMPTS: IPromptsSettings = {
  invalidDtmfPrompt: "That's an invalid option.",
  invalidRecognizePrompt: "I'm sorry. I didn't understand.",
  invalidRecordingPrompt: "I'm sorry. There was a problem with your recording.",
  maxRecordingPrompt: "I'm sorry. Your message was too long.",
  recognizeSilencePrompt: "I couldn't hear anything.",
  recordSilencePrompt: "I couldn't hear anything.",
};

export class SpeechDialog extends Dialog {
  static recognizeSpeech(session: CallSession, playPrompt: PlayPrompt, options: IRecordPromptOptions = {}): void {
    const action = new RecognizeSpeechAction(session).playPrompt(createPrompt(session, playPrompt));
    beginDialog(session, PromptType.speechToText, action.toAction(), options);
  }

  static understandSpeech(session: CallSession, playPrompt: PlayPrompt, options: IRecordPromptOptions = {}): void {
    const action = new UnderstandSpeechAction(session).playPrompt(createPrompt(session, playPrompt));
    beginDialog(session, PromptType.understanding, action.toAction(), options);
  }

  static understandChoice(session: CallSession, playPrompt: PlayPrompt, options: IRecordChoiceOptions): void {
    const action = new UnderstandSpeechAction(session).playPrompt(createPrompt(session, playPrompt));
    options.choices.forEach((x, i) => {
      x.variants.push(i.toString());
      x.variants.push(x.name.toLowerCase());
    });
    beginDialog(session, PromptType.understandingChoice, action.toAction(), options);
  }

  constructor(private speech: SpeechClient, private luis: LuisClient, private prompts = DEFAULT_PROMPTS) {
    super();
  }

  begin(session: CallSession, args: IPromptArgs): void {
    Object.assign(session.dialogData, args);
    session.send(args.action);
    session.sendBatch(); // TODO ensure MP3 format
  }

  replyReceived(session: CallSession): void {
    const args: IPromptArgs = session.dialogData;
    const response = session.message as IConversationResult;
    const result = { state: PromptResponseState.completed } as OperationResult;
    const recordOutcome = response.operationOutcome as IRecordOutcome;

    // recording failed
    if (!recordOutcome) {
      const msg = recordOutcome ? recordOutcome.failureReason : 'Message missing operationOutcome.';
      const error = new Error(`prompt error: ${msg}`);
      session.endDialogWithResult({ resumed: ResumeReason.notCompleted, error }); // TODO pass promptType
      return; // TODO retry
    }

    this.receiveRecordOutcome(response, recordOutcome, result);

    // recording invalid
    if (result.state !== PromptResponseState.completed) {
      this.routeResponse(session, result, args);
      return;
    }

    // parse speech
    this.speech.recognize(result.response.recordedAudio, null, (err, speech) => { // TODO use async lib
      if (err) {
        this.speechError(err, result);
      }

      result.response.speech = speech;

      // parse understanding
      if (!err && args.promptType === PromptType.understanding) {
        this.luis.recognize(speech.header.name, (err, luis) => {
          if (err) {
            this.luisError(err, result);
          }
          result.response.language = luis;
          this.routeResponse(session, result, args);
        });
      } else {
        this.routeResponse(session, result, args);
      }
    });
  }

  dialogResumed(session: CallSession, result: IDialogResult<any>): void {
    if (result.error) {
      session.error(result.error);
    } else if (result.resumed === ResumeReason.completed) {

      // resumed from a LUIS dialog
      if (result.childId.startsWith('LUIS:')) {
        (result.response as IUnderstandRecording).intercepted = true;
        session.endDialogWithResult(result);

      // resumed from a builtin prompt (confirm)
      } else if (result.childId === 'BotBuilder:Prompts') {
        session.dialogData.confirmed = result.response;
        this.replyReceived(session);
      }

    // unknown resume reason, start over
    } else {
      this.replyReceived(session);
    }
  }

  private selectChoice(session: CallSession, result: OperationResult, args: IRecordChoiceOptions): void {
    const speech = result.response.speech.header.name.toLowerCase();
    const choice = args.choices.find((choice) => choice.name === speech || choice.variants.some((x) => x === speech));
    if (choice) {
      result.response.choice = choice;
    } else {
      result.state = PromptResponseState.retry;
      result.retryPrompt = `Sorry, I don't understand ${speech} as a valid option.`;
    }
  }

  private luisError(err: Error, result: OperationResult): void {
    result.state = PromptResponseState.retry;
    result.retryPrompt = this.prompts.invalidRecognizePrompt;
  }

  private speechError(err: Error, result: OperationResult): void {
    switch (err.message) {
      case SPEECH_PROPERTY.NOSPEECH:
        result.state = PromptResponseState.retry;
        result.retryPrompt = this.prompts.recordSilencePrompt;
        break;

      case SPEECH_PROPERTY.FALSERECO:
        result.state = PromptResponseState.retry;
        result.retryPrompt = this.prompts.invalidRecognizePrompt;
        break;

      default:
        result.state = PromptResponseState.retry;
        result.retryPrompt = this.prompts.invalidRecordingPrompt;
        break;
    }
  }

  private receiveRecordOutcome(response: IConversationResult, outcome: IRecordOutcome, result: OperationResult): void {
    switch (outcome.completionReason) {
      case RecordingCompletionReason.completedSilenceDetected:
      case RecordingCompletionReason.completedStopToneDetected:
      case RecordingCompletionReason.maxRecordingTimeout: // TODO make this an optional failure state
        result.response = {
          lengthOfRecordingInSecs: outcome.lengthOfRecordingInSecs,
          recordedAudio: response.recordedAudio,
        } as IUnderstandRecording;
        break;

      case RecordingCompletionReason.callTerminated:
        result.state = PromptResponseState.terminated;
        break;

      case RecordingCompletionReason.temporarySystemFailure:
        result.state = PromptResponseState.failed;

      case RecordingCompletionReason.initialSilenceTimeout:
        result.state = PromptResponseState.retry;
        result.retryPrompt = this.prompts.recordSilencePrompt;

      default:
        result.state = PromptResponseState.retry;
        result.retryPrompt = this.prompts.invalidRecordingPrompt;
        break;
    }
  }

  private routeResponse(session: CallSession, result: OperationResult, args: IPromptArgs): void {
    switch (result.state) {
      case PromptResponseState.canceled:
        session.endDialogWithResult({ resumed: ResumeReason.canceled });
        break;

      case PromptResponseState.completed:
        if (!this.triggerIntent(session, result.response)) {
          if (!this.triggerCancel(session, result.response)) {
            if (args.promptType === PromptType.understandingChoice) {
              this.selectChoice(session, result, args.action as any as IRecordChoiceOptions);
              if (result.state !== PromptResponseState.completed) {
                return this.routeResponse(session, result, args);
              }
            }
            session.endDialogWithResult({ resumed: ResumeReason.completed, response: result.response });
          }
        }
        break;

      case PromptResponseState.failed:
        session.endDialogWithResult({ resumed: ResumeReason.notCompleted, error: new Error('prompt error: service encountered a temporary failure') }); // todo pass promptType
        break;

      case PromptResponseState.retry:
        if (args.maxRetries > 0) {
          args.maxRetries -= 1;
          session.send(result.retryPrompt);
          session.send(args.action);
          session.sendBatch();
        } else {
          session.endDialogWithResult({ resumed: ResumeReason.notCompleted });
        }
        break;

      case PromptResponseState.terminated:
        session.endConversation();
        break;
    }
  }

  private triggerCancel(session: CallSession, result: IUnderstandRecording): boolean {
    if (result.language) {
      const intent = result.language.topScoringIntent;
      const intentDialog = LuisDialog.findCancel(session, intent);
      return this.trigger(session, intentDialog, result, 'cancel');
    }
  }

  private triggerIntent(session: CallSession, result: IUnderstandRecording): boolean {
    if (result.language) {
      const intent = result.language.topScoringIntent;
      const intentDialog = LuisDialog.findTrigger(session, intent);
      return this.trigger(session, intentDialog, result, 'intent');
    }
  }

  private trigger(session: CallSession, intentDialog: LuisDialog, result: IUnderstandRecording, action: 'intent' | 'cancel'): boolean {
    if (intentDialog && this.canMatch(session)) {

      // user must confirm before triggering new dialog
      if (intentDialog.triggerOptions.confirmPrompt && !session.dialogData.confirmed) {
        Prompts.confirm(session, intentDialog.triggerOptions.confirmPrompt);
        return true;

      // launch dialog for this intent
      } else if (action === 'intent') {
        session.beginDialog(`LUIS:${intentDialog.id}`, result);
        return true;

      // cancel this intent
      } else if (action === 'cancel') {
        const dialogInStack = session.sessionState.callstack.find((x) => x.id === `LUIS:${intentDialog.id}`); // TODO check top of stack only

        // this intent is active
        if (dialogInStack) {
          const position = session.sessionState.callstack.indexOf(dialogInStack);
          const returnTo = session.sessionState.callstack[position - 1];
          session.replaceDialog(returnTo.id);
          return true;
        }
      }
    }
    return false;
  }

  private canMatch(session: CallSession): boolean {
    const confirmed = session.dialogData.confirmed;
    return confirmed === true || confirmed !== false;
  }
}

function beginDialog(session: CallSession, promptType: PromptType, action: IAction, options: IPromptOptions): void {
  const maxRetries = typeof options.maxRetries === 'number' ? options.maxRetries : 2;
  delete options.maxRetries;
  Object.assign(action, options);
  session.beginDialog(SPEECH_DIALOG_NAME, { action, maxRetries, promptType });
}

function createPrompt(session: CallSession, playPrompt: PlayPrompt): IAction {
    if (typeof playPrompt === 'string' || Array.isArray(playPrompt)) {
      return PlayPromptAction.text(session, playPrompt).toAction();
    } else if ((playPrompt as IIsAction).toAction) {
      return (playPrompt as IIsAction).toAction();
    } else {
      return playPrompt as IAction;
    }
}

export const SPEECH_LIBRARY_NAME = 'Speech';
export const SPEECH_DIALOG_NAME = `${SPEECH_LIBRARY_NAME}:Prompts`;

export function speechLibrary(speech: SpeechClient, luis: LuisClient): Library {
  const lib = new Library(SPEECH_LIBRARY_NAME);
  lib.dialog(SPEECH_DIALOG_NAME, new SpeechDialog(speech, luis));
  return lib;
}
