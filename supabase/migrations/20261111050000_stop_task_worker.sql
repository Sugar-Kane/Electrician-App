-- The task list was removed from the app, and with it the worker this job
-- called every minute (/api/tasks/worker). Stop the schedule so nothing keeps
-- posting to a route that no longer exists.
--
-- Nothing else changes: the task tables and their rows are left as they are.

select cron.unschedule(job.jobid)
from cron.job as job
where job.jobname = 'volteira-task-worker';
