import type { AnyDescriptor } from '../contracts/index.js';

export const requiresConfirmation = (
  descriptor: Pick<AnyDescriptor, 'confirmation' | 'reversibility'>,
  source: 'text' | 'voice',
): boolean => {
  const irreversible = descriptor.reversibility.kind === 'none';
  if (source === 'voice' && irreversible) {
    return true;
  }
  switch (descriptor.confirmation) {
    case 'always':
      return true;
    case 'never':
      return false;
    case 'whenVoice':
      return source === 'voice';
    case 'whenIrreversible':
      return irreversible;
  }
};
