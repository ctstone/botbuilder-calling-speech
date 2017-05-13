import {
  CallSession, Dialog, IAction,
  IConversationResult, IDialogResult, IDialogWaterfallStep,
  IIsAction, IPromptOptions, IRecording,
  IRecordOutcome, IRecordPromptOptions, Library,
  PlayPromptAction, Prompts, RecordAction,
  RecordingCompletionReason, ResumeReason } from 'botbuilder-calling';
import { Intent } from 'cognitive-luis-client';

import { IPromptArgs, PromptType } from './speech-dialog';

export interface DialogActionOptions {
  match: string;
  threshold?: number;
}

export interface TriggerActionOptions extends DialogActionOptions {
  confirmPrompt?: string;
}

export interface CancelActionOptions extends DialogActionOptions {
  confirmPrompt?: string;
}

function matchIntent(options: DialogActionOptions, intent: Intent): boolean {
  return options.match === intent.intent && (!options.threshold || intent.score > options.threshold);
}

export class LuisDialog extends Dialog {
  static findTrigger(session: CallSession, intent: Intent): LuisDialog {
    const dialog = LuisDialog.intents
      .filter((x) => x.triggerOptions)
      .find((x) => matchIntent(x.triggerOptions, intent));

    if (!dialog) {
      return null;
    }

    return LuisDialog.registerDialog(session, dialog);
  }

  static findCancel(session: CallSession, intent: Intent): LuisDialog {
    const dialog = LuisDialog.intents
      .filter((x) => x.cancelOptions)
      .find((x) => matchIntent(x.cancelOptions, intent));

    if (!dialog) {
      return null;
    }

    return LuisDialog.registerDialog(session, dialog);
  }

  private static intents: LuisDialog[] = [];
  private static registerDialog(session: CallSession, dialog: LuisDialog): LuisDialog {
    let lib = session.library.library('LUIS');
    if (!lib) {
      lib = session.library.library(new Library('LUIS'));
    }

    if (dialog && !lib.dialog(dialog.id)) {
      lib.dialog(`${dialog.id}.intent`, dialog.dialog);
      lib.dialog(dialog.id, dialog.dialog);
    }
    return dialog;
  }


  triggerOptions: TriggerActionOptions;
  cancelOptions: CancelActionOptions;
  id: string;

  constructor(private dialog: Dialog | IDialogWaterfallStep[] | IDialogWaterfallStep) {
    super();
    LuisDialog.intents.push(this);
    this.id = (LuisDialog.intents.length).toString();
  }

  begin(session: CallSession, args?: any) {
    console.log('begin luis');
    session.beginDialog(`LUIS:${this.id}.intent`, args);
  }

  replyReceived(session: CallSession): void {
    console.log('luis reply');
    throw new Error("Method not implemented.");
  }

  dialogResumed<T>(session: CallSession, result: IDialogResult<T>): void {
    console.log('luis resume');
    if (result.error) {
      session.error(result.error);
    }
  }

  triggerAction(action: TriggerActionOptions): LuisDialog {
    this.triggerOptions = action;
    return this;
  }

  cancelAction(action: CancelActionOptions): LuisDialog {
    this.cancelOptions = action;
    return this;
  }
}
