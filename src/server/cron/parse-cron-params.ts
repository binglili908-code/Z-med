import { CronRouteError } from "@/server/cron/run-cron-route";

type IntegerParamOptions = {
  defaultValue: number;
  min: number;
  max: number;
};

type OptionalIntegerParamOptions = {
  min: number;
  max: number;
};

export function parseCronIntegerParam(
  req: Request,
  name: string,
  options: IntegerParamOptions,
) {
  const value = new URL(req.url).searchParams.get(name);
  if (value == null || value.trim() === "") {
    return options.defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new CronRouteError(`${name} must be an integer`, 400);
  }

  return Math.max(options.min, Math.min(options.max, parsed));
}

export function parseOptionalCronIntegerParam(
  req: Request,
  name: string,
  options: OptionalIntegerParamOptions,
) {
  const value = new URL(req.url).searchParams.get(name);
  if (value == null || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new CronRouteError(`${name} must be an integer`, 400);
  }

  return Math.max(options.min, Math.min(options.max, parsed));
}

export function parseCronBooleanParam(req: Request, name: string) {
  const value = new URL(req.url).searchParams.get(name);
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
