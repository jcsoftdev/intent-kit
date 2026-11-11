import { IntentDefinitionError } from '../contracts/index.js';
import type {
  AnyDescriptor,
  Destination,
  DestinationRule,
  StandardSchemaV1,
} from '../contracts/index.js';
import { parsePath, templateReferences } from '../primitives/index.js';

const ID_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;
const TEMPLATE_ROOTS: ReadonlySet<string> = new Set(['input', 'output']);

export const isCapabilityId = (value: string): boolean => ID_PATTERN.test(value);

const isStandardSchema = (schema: StandardSchemaV1 | undefined): boolean => {
  const props = (schema as { '~standard'?: Partial<StandardSchemaV1.Props> } | undefined)?.[
    '~standard'
  ];
  return props?.version === 1 && typeof props.validate === 'function';
};

const rootOf = (reference: string): string => reference.split('.')[0] as string;

const assertTemplate = (template: string, subject: string): void => {
  for (const reference of templateReferences(template)) {
    if (!TEMPLATE_ROOTS.has(rootOf(reference))) {
      throw new IntentDefinitionError('INVALID_TEMPLATE', `${subject}:${reference}`);
    }
  }
};

const assertDestinationTemplates = (destination: Destination<string>, subject: string): void => {
  for (const [name, template] of Object.entries(destination.params ?? {})) {
    assertTemplate(template, `${subject}.params.${name}`);
  }
  if (destination.target?.key !== undefined) {
    assertTemplate(destination.target.key, `${subject}.target.key`);
  }
};

const assertRuleTemplates = (rule: DestinationRule<string, string>, subject: string): void => {
  assertDestinationTemplates(rule.default, `${subject}:default`);
  for (const [role, destination] of Object.entries(rule.byRole ?? {})) {
    if (destination) {
      assertDestinationTemplates(destination, `${subject}:byRole.${role}`);
    }
  }
};

const assertReversibility = (descriptor: AnyDescriptor): void => {
  const { reversibility, id } = descriptor;
  if (reversibility.kind === 'compensate') {
    const validWindow = Number.isFinite(reversibility.windowMs) && reversibility.windowMs >= 0;
    if (!validWindow || !isCapabilityId(reversibility.via)) {
      throw new IntentDefinitionError('INVALID_REVERSIBILITY', id);
    }
  }
  if (
    reversibility.kind === 'grace' &&
    !(Number.isFinite(reversibility.delayMs) && reversibility.delayMs > 0)
  ) {
    throw new IntentDefinitionError('INVALID_REVERSIBILITY', id);
  }
};

export const validateDescriptor = (descriptor: AnyDescriptor): void => {
  const { id } = descriptor;
  if (typeof id !== 'string' || !isCapabilityId(id)) {
    throw new IntentDefinitionError('INVALID_ID', String(id));
  }
  if (!Number.isInteger(descriptor.version) || descriptor.version < 1) {
    throw new IntentDefinitionError('INVALID_VERSION', id);
  }
  if (!isStandardSchema(descriptor.input)) {
    throw new IntentDefinitionError('INVALID_SCHEMA', `${id}:input`);
  }
  if (descriptor.output !== undefined && !isStandardSchema(descriptor.output)) {
    throw new IntentDefinitionError('INVALID_SCHEMA', `${id}:output`);
  }
  for (const entity of descriptor.entities) {
    parsePath(entity.path);
  }
  if (descriptor.destination) {
    assertRuleTemplates(descriptor.destination, id);
  }
  assertReversibility(descriptor);
  if (descriptor.agent !== 'never' && descriptor.roles.length === 0) {
    throw new IntentDefinitionError('INVALID_ROLES', id);
  }
  if (descriptor.kind === 'navigate' && !descriptor.destination && !descriptor.output) {
    throw new IntentDefinitionError('INVALID_DESTINATION', id);
  }
};
