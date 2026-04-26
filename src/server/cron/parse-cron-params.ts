import { CronRouteError } from "@/server/cron/run-cron-route";

type IntegerParamOptions = {
  defaultValue: number;
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
