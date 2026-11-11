import type { FormBinding, FormBindingRegistry } from '../contracts/index.js';

interface Registration {
  readonly binding: FormBinding<unknown>;
  readonly routeId: string;
}

export const createFormBindingRegistry = (): FormBindingRegistry => {
  const registrations = new Map<string, Registration>();
  return {
    register(binding, routeId) {
      const registration: Registration = { binding, routeId };
      registrations.set(binding.formId, registration);
      return () => {
        if (registrations.get(binding.formId) === registration) {
          registrations.delete(binding.formId);
        }
      };
    },
    find: (formId) => registrations.get(formId),
  };
};
