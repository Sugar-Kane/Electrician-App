type RouteDateJob = {
  id: string;
  date: string;
  status: string;
};

/** Choose the service day shown by the route builder. */
export function routeDateFor(input: {
  jobs: RouteDateJob[];
  today: string;
  focusJobId?: string;
}): string {
  const active = (job: RouteDateJob) =>
    job.status !== "Canceled" && job.status !== "Completed";
  const focusedDate = input.jobs.find(
    (job) => job.id === input.focusJobId && active(job),
  )?.date.trim();

  if (focusedDate) return focusedDate;

  return (
    input.jobs.find((job) => job.date === input.today && active(job))?.date ||
    input.jobs.find((job) => job.date >= input.today && active(job))?.date ||
    input.today
  );
}
