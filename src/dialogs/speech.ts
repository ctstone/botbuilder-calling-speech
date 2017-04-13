import {
  CallSession, Dialog, IAction,
  IConversationResult, IIsAction, IPromptOptions,
  IRecording, IRecordOutcome, IRecordPromptOptions,
  Library, PlayPromptAction, Prompts,
  RecordAction, RecordingCompletionReason, ResumeReason } from 'botbuilder-calling';
import { LuisClient, LuisResult } from 'cognitive-luis-client';
import { SPEECH_PROPERTY, SPEECH_STATUS, SpeechClient, SpeechResult } from 'cognitive-speech-client';
import { RecognizeSpeechAction } from '../workflow/recognize-speech-action';
import { UnderstandSpeechAction } from '../workflow/understand-speech-action';

export type PlayPrompt = string|string[]|IAction|IIsAction;

export enum PromptType { action, confirm, choice, digits, record, speechToText, understanding }

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

  constructor(private speech: SpeechClient, private luis: LuisClient, private prompts = DEFAULT_PROMPTS) {
    super();
  }

  begin(session: CallSession, args: IPromptArgs): void {
    Object.assign(session.dialogData, args);
    session.send(args.action);
    session.sendBatch();
  }

  replyReceived(session: CallSession): void {
    const args: IPromptArgs = session.dialogData;
    const response = session.message as IConversationResult;
    const result = { state: PromptResponseState.completed } as OperationResult;
    const recordOutcome = response.operationOutcome as IRecordOutcome;

    // console.log('[ RESPONSE ]', JSON.stringify(response, null, 2));

    // recording failed
    if (!recordOutcome) {
      const msg = recordOutcome ? recordOutcome.failureReason : 'Message missing operationOutcome.';
      const error = new Error(`prompt error: ${msg}`);
      session.endDialogWithResult({ resumed: ResumeReason.notCompleted, error }); // TODO pass promptType
      return;
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
      console.log('[ SPEECH ]', err, speech);

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
        session.endDialogWithResult({ resumed: ResumeReason.completed, response: result.response });
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
}

function beginDialog(session: CallSession, promptType: PromptType, action: IAction, options: IPromptOptions): void {
  const maxRetries = typeof options.maxRetries === 'number' ? options.maxRetries : 2;
  delete options.maxRetries;
  Object.assign(action, options);
  // console.log('[ BEGIN DIALOG ]', JSON.stringify({ action, maxRetries, promptType }, null, 2));
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
