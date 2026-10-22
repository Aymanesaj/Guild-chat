
import {
  claimAvatarCleanupJobs,
  completeAvatarCleanupJob,
  retryAvatarCleanupJob,
  findActiveAvatarReference,
} from "../repositories/avatar-cleanup.repository.js";

import {
  deleteAvatarMedia,
} from "../clients/media.client.js";

export async function processAvatarCleanupJobs(
  limit = 10,
): Promise<{
  claimed: number;
  completed: number;
  retried: number;
}> {
  // 1. Claim jobs that are ready for processing.
  const jobs = await claimAvatarCleanupJobs(limit);

  let completed = 0;
  let retried = 0;

  // 2. Process each job independently.
  for (const job of jobs) {
    try {
      // 3. Check the user's current avatar reference.
      const user = await findActiveAvatarReference(
        job.userId,
      );

      // Never delete an avatar currently in use.
      if (user?.avatarMediaId === job.mediaId) {
        await retryAvatarCleanupJob(
          job.id,
          job.attempts,
        );

        retried++;
        continue;
      }

      // 4. Request physical deletion from Media.
      await deleteAvatarMedia(
        job.mediaId,
        job.userId,
      );

      // 5. Record successful cleanup.
      const result = await completeAvatarCleanupJob(
        job.id,
        job.attempts,
      );

      completed += result.count;
    } catch (error) {
      // 6. Temporary failure: schedule another attempt.
      console.error(
        "Avatar cleanup failed",
        {
          jobId: job.id,
          error,
        },
      );

      await retryAvatarCleanupJob(
        job.id,
        job.attempts,
      );

      retried++;
    }
  }

  return {
    claimed: jobs.length,
    completed,
    retried,
  };
}
