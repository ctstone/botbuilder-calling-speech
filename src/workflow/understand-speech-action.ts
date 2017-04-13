import { IIsAction, RecordAction } from 'botbuilder-calling';
import { IRecognizeSpeechAction, RecognizeSpeechAction } from './recognize-speech-action';

export interface IUnderstandSpeechAction extends IRecognizeSpeechAction {
  understand: boolean;
}

export class UnderstandSpeechAction extends RecognizeSpeechAction {
  toAction(): IUnderstandSpeechAction {
    return Object.assign(super.toAction(), { understand: true });
  }
}
