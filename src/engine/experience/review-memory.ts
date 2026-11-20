/**
 * @module engine/experience/review-memory
 * Persistent review memory for tracking deferred or recurring visitor experience issues across simulation runs.
 */
import type {Point, Scene} from '../../types';

export interface ReviewIssueInput {
  type: string;
  target?: string | null;
  place?: string;
  point?: Point;
  action?: string;
  detail?: string;
}

export function issueKey(issue: ReviewIssueInput): string {
  return (
    issue.type +
    ':' +
    (issue.target ||
      issue.place ||
      (issue.point
        ? Math.floor(issue.point[0] / 10) + ',' + Math.floor(issue.point[1] / 10)
        : 'general'))
  );
}

export function deferIssue(scene: Scene, issue: ReviewIssueInput) {
  scene.reviewMemory ??= {};
  const key = issueKey(issue);
  const prior = scene.reviewMemory[key];
  scene.reviewMemory[key] = {
    key,
    type: issue.type,
    target: issue.target || null,
    description: issue.action || issue.detail || issue.type,
    count: (prior?.count || 0) + 1,
    observedRuns: prior?.observedRuns || 0,
    status: 'pending',
    lastDeferred: new Date().toISOString(),
    firstDeferred: prior?.firstDeferred || new Date().toISOString(),
  };
  return scene.reviewMemory[key];
}

export function observeIssues(
  scene: Scene,
  issues: ReviewIssueInput[],
  runId: string
): void {
  scene.reviewMemory ??= {};
  for (const issue of issues) {
    const key = issueKey(issue);
    const prior = scene.reviewMemory[key];
    if (prior?.lastObservedRun === runId) continue;
    scene.reviewMemory[key] = {
      ...prior,
      key,
      type: issue.type,
      target: issue.target || null,
      description: issue.action || issue.type,
      count: prior?.count || 0,
      observedRuns: (prior?.observedRuns || 0) + 1,
      lastObservedRun: runId,
      status: 'pending',
    };
  }
}

export function issuePriority(
  memory?: {count?: number; observedRuns?: number} | null
): number {
  return (memory?.count || 0) + Math.max(0, (memory?.observedRuns || 0) - 1);
}
