import { z } from 'zod';

export const ordersCreateInput = z.object({
  tableId: z.uuid(),
  lines: z
    .array(
      z.object({
        offeringId: z.uuid(),
        quantity: z.int().min(1).default(1),
        modifiers: z.array(z.uuid()).default([]),
      }),
    )
    .min(1),
});

export const ordersCreateOutput = z.object({
  orderId: z.string(),
  serviceNumber: z.number(),
  total: z.number(),
  tableLabel: z.string(),
});

export const markReadyInput = z.object({ lineIds: z.array(z.uuid()).min(1) });

export const markReadyOutput = z.object({
  orderId: z.string(),
  serviceNumber: z.number(),
  dishName: z.string(),
  tableLabel: z.string(),
});

export const recallInput = z.object({ orderId: z.uuid() });
export const recallOutput = z.object({ removed: z.number() });

export const closeShiftInput = z.object({});
export const closeShiftOutput = z.object({ closed: z.boolean() });

export const changePasswordInput = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8),
});
export const changePasswordOutput = z.object({ changed: z.boolean() });

export type OrdersCreateInput = z.output<typeof ordersCreateInput>;
export type OrdersCreateOutput = z.output<typeof ordersCreateOutput>;
export type MarkReadyInput = z.output<typeof markReadyInput>;
export type MarkReadyOutput = z.output<typeof markReadyOutput>;
export type RecallInput = z.output<typeof recallInput>;
export type RecallOutput = z.output<typeof recallOutput>;
export type CloseShiftInput = z.output<typeof closeShiftInput>;
export type CloseShiftOutput = z.output<typeof closeShiftOutput>;
export type ChangePasswordInput = z.output<typeof changePasswordInput>;
export type ChangePasswordOutput = z.output<typeof changePasswordOutput>;
