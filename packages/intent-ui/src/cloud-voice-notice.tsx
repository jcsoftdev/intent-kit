import { AlertDialog } from '@jcsoftdev/ui/overlays';
import type { AssistantCopy } from './copy.js';

export interface CloudVoiceNoticeProps {
  readonly open: boolean;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
  readonly copy: AssistantCopy;
}

export function CloudVoiceNotice({ open, onAccept, onDecline, copy }: CloudVoiceNoticeProps) {
  const { cloudNotice } = copy;
  return (
    <AlertDialog
      open={open}
      title={cloudNotice.title}
      description={cloudNotice.body}
      confirmLabel={cloudNotice.accept}
      cancelLabel={cloudNotice.decline}
      onConfirm={async () => onAccept()}
      onCancel={onDecline}
    />
  );
}
