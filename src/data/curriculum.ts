import { ModuleSpec, SubLesson } from '../types';
import { module1 } from './module1';
import { module2 } from './module2';
import { module3 } from './module3';
import { module4 } from './module4';
import { module5 } from './module5';
import { module6 } from './module6';
import { module7 } from './module7';

export const CURRICULUM: ModuleSpec[] = [
  module1,
  module2,
  module3,
  module4,
  module5,
  module6,
  module7,
];

export const ALL_STEPS: SubLesson[] = CURRICULUM.flatMap((m) => m.steps);

export function getStepById(stepId: string): SubLesson {
  return ALL_STEPS.find((s) => s.id === stepId) ?? ALL_STEPS[0];
}

export function getAdjacentSteps(stepId: string): {
  prev: SubLesson | null;
  next: SubLesson | null;
} {
  const idx = ALL_STEPS.findIndex((s) => s.id === stepId);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? ALL_STEPS[idx - 1] : null,
    next: idx < ALL_STEPS.length - 1 ? ALL_STEPS[idx + 1] : null,
  };
}

/**
 * Returns the index of the furthest unlocked step:
 * first step not yet completed (or last step if all are completed).
 */
export function getFrontierIndex(completedIds: string[]): number {
  const firstIncomplete = ALL_STEPS.findIndex((s) => !completedIds.includes(s.id));
  return firstIncomplete === -1 ? ALL_STEPS.length - 1 : firstIncomplete;
}

export function isStepUnlocked(stepId: string, completedIds: string[]): boolean {
  const idx = ALL_STEPS.findIndex((s) => s.id === stepId);
  if (idx === -1) return false;
  return idx <= getFrontierIndex(completedIds);
}
