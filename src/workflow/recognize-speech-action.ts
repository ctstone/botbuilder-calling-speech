import { IAction, IRecordAction, RecordAction } from 'botbuilder-calling';

export interface IRecognizeSpeechAction extends IRecordAction {
  speechToText: boolean;
}

export class RecognizeSpeechAction extends RecordAction {
  toAction(): IRecognizeSpeechAction {
    return Object.assign(super.toAction(), { speechToText: true });
  }
}
