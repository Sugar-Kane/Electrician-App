-- Jobs written by the server could not be saved.
--
-- sync_job_document_folder files every new or moved job into the business's
-- document tree. It ran with the caller's rights and calls helpers in the
-- private schema. A signed-in owner has usage on that schema, so the job page
-- worked; the server's service role does not, so a job created or rescheduled
-- from ChatGPT or Claude (/api/mcp) failed with 42501 "permission denied for
-- schema private", and the whole insert rolled back.
--
-- Running the trigger as its owner fixes both callers without opening the
-- private schema to the service role. It only writes folders for the row's own
-- business, and the job insert or update that fires it is still checked by the
-- jobs table's own rules. search_path is already pinned to ''.

alter function private.sync_job_document_folder() security definer;
