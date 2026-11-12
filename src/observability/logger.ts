/**
 * Minimal structured logger facade.
 *
 * The production facade tees every line to stdout and to a correlation-index
 * table with request attribution; this showcase version writes JSON lines to
 * the console with the same call surface, so modules depend on the facade
 * rather than on `console` directly.
 */

export type LogContext = Readonly<Record<string, unknown>>;

export interface Logger {
  readonly info: (message: string, context?: LogContext) => void;
  readonly warn: (message: string, context?: LogContext) => void;
  readonly error: (message: string, error?: unknown, context?: LogContext) => void;
}

function emit(
  level: "info" | "warn" | "error",
  source: string,
  message: string,
  context?: LogContext,
): void {
  if (process.env.SHOWCASE_SILENT_LOGS === "1") return;
  const line = JSON.stringify({ level, source, message, ...context });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function getLogger(source: string): Logger {
  return {
    info: (message, context) => emit("info", source, message, context),
    warn: (message, context) => emit("warn", source, message, context),
    error: (message, error, context) =>
      emit("error", source, message, {
        ...context,
        error: error instanceof Error ? error.message : error,
      }),
  };
}
