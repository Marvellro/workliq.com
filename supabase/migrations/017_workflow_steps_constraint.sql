-- Run this AFTER deploying the code from 016, not before.

-- ─── The shape constraint 016 deliberately left out ───────────────────────────
-- 016 added `workflows.steps` with a `'[]'::jsonb` default so the column could
-- be added to existing rows. Code deployed before that migration inserts a
-- workflow without naming `steps`, so it receives that default — and a
-- constraint demanding at least one step rejects the insert.
--
-- Applying this at the same time as 016 therefore breaks workflow creation for
-- every request served by the old code, which is the window between running the
-- migration and the deploy finishing. It is not a long window. It is still
-- entirely avoidable, and it broke production once already.
--
-- The rule: a constraint the currently-running code can violate waits until
-- that code is gone. Add the column permissively, deploy the code that always
-- populates it, then constrain.
--
-- Safe to run once no deployment can still insert a workflow without steps.

alter table workflows drop constraint if exists workflows_steps_check;
alter table workflows add  constraint workflows_steps_check
  check (
    jsonb_typeof(steps) = 'array'
    and jsonb_array_length(steps) between 1 and 10
  );
