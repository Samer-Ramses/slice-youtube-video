export interface ReadyClipJob {
  id: string;
  filePath: string;
  fileName: string;
  asciiFileName: string;
  size: number;
  cleanup: () => Promise<void>;
  timer: ReturnType<typeof setTimeout>;
}

const globalForJobs = globalThis as unknown as {
  __sliceReadyJobs?: Map<string, ReadyClipJob>;
};

const jobs = (globalForJobs.__sliceReadyJobs ??= new Map<string, ReadyClipJob>());

const JOB_TTL_MS = 5 * 60 * 1000;

export function saveReadyJob(job: Omit<ReadyClipJob, "timer">): void {
  const timer = setTimeout(() => {
    const existing = jobs.get(job.id);
    if (existing) {
      jobs.delete(job.id);
      void existing.cleanup();
    }
  }, JOB_TTL_MS);

  jobs.set(job.id, { ...job, timer });
}

export function takeReadyJob(id: string): ReadyClipJob | null {
  const job = jobs.get(id);
  if (!job) return null;
  clearTimeout(job.timer);
  jobs.delete(id);
  return job;
}
