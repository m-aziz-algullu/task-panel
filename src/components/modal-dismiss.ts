/** How a modal can be dismissed apart from its close button. Pure: safe for unit tests. */
export type ModalDismissal = {
  /** A press on the backdrop closes the modal. Turn it off for forms whose input a stray click would lose. */
  backdrop: boolean;
};

export const DEFAULT_DISMISSAL: ModalDismissal = { backdrop: true };

/**
 * Whether a mouse press should close the modal. Inside a native modal <dialog>, a press whose
 * target is the dialog element itself (not its content) landed on the backdrop.
 */
export function closesOnPress(target: EventTarget | null, dialog: EventTarget | null, dismissal: ModalDismissal) {
  return dismissal.backdrop && target !== null && target === dialog;
}

/**
 * The task dialog (new and existing tasks) closes only from its close button or Escape: a click
 * beside it while typing a title or description would otherwise throw the unsaved input away.
 */
export const TASK_DIALOG_DISMISSAL: ModalDismissal = { backdrop: false };
