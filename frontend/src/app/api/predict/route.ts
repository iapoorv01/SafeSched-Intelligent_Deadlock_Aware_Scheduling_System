import { store } from '../store';

type PredictInput = {
  processes: number;
  resources: number;
  allocation_matrix: number[][];
  max_matrix: number[][];
  available: number[];
};

function validateInput(body: PredictInput): string | null {
  const { processes, resources, allocation_matrix, max_matrix, available } = body;
  if (processes <= 0 || resources <= 0) {
    return 'Processes and resources must be greater than zero.';
  }
  if (allocation_matrix.length !== processes || max_matrix.length !== processes) {
    return 'Matrix row count must match number of processes.';
  }
  if (available.length !== resources) {
    return 'Available vector length must match resource count.';
  }

  for (let i = 0; i < processes; i++) {
    if ((allocation_matrix[i] ?? []).length !== resources || (max_matrix[i] ?? []).length !== resources) {
      return 'Each matrix row must match number of resources.';
    }
    for (let j = 0; j < resources; j++) {
      const alloc = allocation_matrix[i][j];
      const max = max_matrix[i][j];
      if (alloc < 0 || max < 0 || available[j] < 0) {
        return 'Negative values are not allowed.';
      }
      if (alloc > max) {
        return `Allocation cannot exceed max demand at P${i}, R${j}.`;
      }
    }
  }

  return null;
}

function computeNeed(max: number[][], allocation: number[][]): number[][] {
  return max.map((row, i) => row.map((m, j) => Math.max(0, m - (allocation[i]?.[j] ?? 0))));
}

function isRunnable(needRow: number[], work: number[]): boolean {
  return needRow.every((n, i) => n <= work[i]);
}

export async function POST(body: PredictInput) {
  const validationError = validateInput(body);
  if (validationError) {
    throw new Error(validationError);
  }

  const { processes, allocation_matrix, max_matrix, available } = body;
  const need = computeNeed(max_matrix, allocation_matrix);
  const work = [...available];
  const finish = Array(processes).fill(false);
  const safeSequence: number[] = [];

  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < processes; i++) {
      if (!finish[i] && isRunnable(need[i], work)) {
        finish[i] = true;
        safeSequence.push(i);
        for (let j = 0; j < work.length; j++) {
          work[j] += allocation_matrix[i]?.[j] ?? 0;
        }
        progress = true;
      }
    }
  }

  const deadlockedProcesses = finish
    .map((done, idx) => (done ? -1 : idx))
    .filter((idx) => idx >= 0);
  const logicalDeadlock = deadlockedProcesses.length > 0;
  const isStarvation = !logicalDeadlock && safeSequence.length > 0 && safeSequence.length < processes;
  const confidence = logicalDeadlock ? 0.92 : isStarvation ? 0.79 : 0.96;

  if (logicalDeadlock) {
    store.analytics.deadlocksDetected += 1;
  } else if (store.analytics.deadlocksDetected > 0) {
    store.analytics.recoveriesApplied += 1;
  }

  return {
    deadlock: logicalDeadlock ? 1 : 0,
    confidence,
    logical_deadlock: logicalDeadlock ? 1 : 0,
    is_starvation: isStarvation,
    deadlocked_processes: deadlockedProcesses,
    safe_sequence: safeSequence,
    immediate_runnable: safeSequence.length > 0 ? safeSequence[0] : -1,
    recommended_action: logicalDeadlock
      ? `Process ${deadlockedProcesses[0]} should be preempted to break circular wait.`
      : isStarvation
        ? 'Potential starvation detected. Apply aging/fair scheduling or release constrained resources.'
        : 'No intervention required. Current state is safe.',
  };
}
