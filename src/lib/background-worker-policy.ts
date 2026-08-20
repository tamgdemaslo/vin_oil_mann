export function inProcessBackgroundWorkersEnabled() {
  // Background integrations must not compete with interactive HTTP requests
  // inside the single production web process. They may be enabled only on a
  // dedicated worker process (or deliberately in a larger deployment).
  return process.env.APP_IN_PROCESS_BACKGROUND_WORKERS_ENABLED === "1";
}
