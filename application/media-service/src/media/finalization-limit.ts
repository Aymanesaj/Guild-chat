const MAX_ACTIVE_FINALIZATIONS = 2;

let activeFinalizations = 0;

export class FinalizationBusyError extends Error {
  constructor() {
    super("Media finalization capacity reached; retry later");
    this.name = "FinalizationBusyError";
  }
}

export async function withFinalizationSlot<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (activeFinalizations >= MAX_ACTIVE_FINALIZATIONS) {
    throw new FinalizationBusyError();
  }

  activeFinalizations++;

  try {
    return await operation();
  } finally {
    activeFinalizations--;
  }
}
