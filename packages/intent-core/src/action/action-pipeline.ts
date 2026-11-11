import type {
  ActionLifecycle,
  ActionResult,
  Announcer,
  AnyDescriptor,
  Authorizer,
  CapabilityRegistry,
  Clock,
  Compensator,
  ConfirmationPort,
  Effect,
  EventBus,
  ExecutablePlan,
  FormBindingRegistry,
  IntentEvent,
  MessageCatalog,
  Pipeline,
  PipelineBuilder,
  Presentation,
  Revealer,
  RouterAdapter,
  Stage,
  StageName,
  TargetRegistry,
  UndoEntry,
  UndoRegistry,
} from '../contracts/index.js';
import { createPipelineBuilder } from '../pipeline/index.js';
import { systemClock } from '../primitives/index.js';
import { CONFIRM_STAGE, createConfirmStage } from './confirm-stage.js';
import { EXECUTE_STAGE, createExecuteStage } from './execute-stage.js';
import { GUARD_STAGE, createGuardStage } from './guard-stage.js';
import { LOAD_EFFECT_STAGE, createLoadEffectStage, isHandoff } from './load-effect-stage.js';
import { OFFER_UNDO_STAGE, createOfferUndoStage } from './offer-undo-stage.js';
import { PRESENT_STAGE, createPresentStage } from './present-stage.js';
import { REVALIDATE_STAGE, createRevalidateStage } from './revalidate-stage.js';

export interface ActionState<TPrincipal, TRole extends string> {
  readonly plan: ExecutablePlan;
  readonly principal: TPrincipal;
  readonly role: TRole;
  readonly lifecycle: ActionLifecycle;
  readonly descriptor: AnyDescriptor;
  readonly input: unknown;
  readonly effect: Effect<unknown, unknown>;
  readonly output: unknown;
  readonly presentation: Presentation;
  readonly undo: UndoEntry;
}

export type ActionStage<TPrincipal, TRole extends string> = Stage<
  ActionState<TPrincipal, TRole>,
  ActionResult
>;

export interface ActionBudgets {
  readonly executeMs: number;
  readonly presentMs: number;
  readonly targetMs: number;
}

export const DEFAULT_ACTION_BUDGETS: ActionBudgets = {
  executeMs: 10_000,
  presentMs: 3_000,
  targetMs: 3_000,
};

export const ACTION_STAGES: {
  readonly revalidate: StageName;
  readonly confirm: StageName;
  readonly guard: StageName;
  readonly loadEffect: StageName;
  readonly execute: StageName;
  readonly present: StageName;
  readonly offerUndo: StageName;
} = {
  revalidate: REVALIDATE_STAGE,
  confirm: CONFIRM_STAGE,
  guard: GUARD_STAGE,
  loadEffect: LOAD_EFFECT_STAGE,
  execute: EXECUTE_STAGE,
  present: PRESENT_STAGE,
  offerUndo: OFFER_UNDO_STAGE,
};

export interface ActionPipelineConfig<
  TPrincipal,
  TRole extends string,
  TRouteId extends string,
  TElement,
> {
  readonly registry: CapabilityRegistry;
  readonly authorizer: Authorizer<TPrincipal>;
  readonly confirmation: ConfirmationPort;
  readonly router: RouterAdapter<TRouteId>;
  readonly targets: TargetRegistry<TElement>;
  readonly revealer: Revealer<TElement>;
  readonly announcer: Announcer;
  readonly messages: MessageCatalog;
  readonly forms?: FormBindingRegistry;
  readonly undo?: UndoRegistry;
  readonly compensator?: Compensator;
  readonly clock?: Clock;
  readonly events?: EventBus<IntentEvent>;
  readonly budgets?: Partial<ActionBudgets>;
  readonly customize?: (
    builder: PipelineBuilder<ActionState<TPrincipal, TRole>, ActionResult>,
  ) => PipelineBuilder<ActionState<TPrincipal, TRole>, ActionResult>;
}

const identity = <T>(value: T): T => value;

export function createActionPipeline<
  TPrincipal,
  TRole extends string,
  TRouteId extends string,
  TElement,
>(
  config: ActionPipelineConfig<TPrincipal, TRole, TRouteId, TElement>,
): Pipeline<ActionState<TPrincipal, TRole>, ActionResult> {
  const clock = config.clock ?? systemClock;
  const budgets = { ...DEFAULT_ACTION_BUDGETS, ...config.budgets };
  const builder = createPipelineBuilder<ActionState<TPrincipal, TRole>, ActionResult>({
    name: 'action',
    seeds: ['plan', 'principal', 'role', 'lifecycle'],
    clock,
    events: config.events,
    terminal: {
      requires: ['plan', 'descriptor', 'presentation'],
      async settle(context) {
        const { planId } = context.get('plan');
        const descriptor = context.get('descriptor');
        const presentation = context.get('presentation');
        if (isHandoff(descriptor)) {
          return {
            ok: true,
            value: { status: 'handedOff', planId, capabilityId: descriptor.id, presentation },
          };
        }
        const undo = context.find('undo');
        return {
          ok: true,
          value: {
            status: 'completed',
            planId,
            capabilityId: descriptor.id,
            output: context.find('output'),
            presentation,
            ...(undo ? { undo } : {}),
          },
        };
      },
    },
  })
    .use(createRevalidateStage({ registry: config.registry, authorizer: config.authorizer }))
    .use(createConfirmStage({ confirmation: config.confirmation, messages: config.messages }))
    .use(createGuardStage())
    .use(
      createLoadEffectStage({
        registry: config.registry,
        router: config.router,
        ...(config.forms ? { forms: config.forms } : {}),
      }),
    )
    .use(
      createExecuteStage({
        authorizer: config.authorizer,
        clock,
        executeMs: budgets.executeMs,
        ...(config.undo ? { undo: config.undo } : {}),
      }),
    )
    .use(
      createPresentStage({
        router: config.router,
        targets: config.targets,
        revealer: config.revealer,
        announcer: config.announcer,
        messages: config.messages,
        clock,
        presentMs: budgets.presentMs,
        targetMs: budgets.targetMs,
      }),
    )
    .use(
      createOfferUndoStage({
        clock,
        ...(config.undo ? { undo: config.undo } : {}),
        ...(config.compensator ? { compensator: config.compensator } : {}),
      }),
    );
  return (config.customize ?? identity)(builder).build();
}
