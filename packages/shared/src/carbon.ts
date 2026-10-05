import { co2 } from "@tgwf/co2";
import { transferSchema } from "./index.ts";
export const CO2_VERSION = "0.18.0";
export function transfer(input: unknown) {
  const v = transferSchema.parse(input);
  if (v.packageVersion !== CO2_VERSION)
    throw new Error(
      "This CO2.js package version cannot be reproduced by the installed calculator.",
    );
  const grams = new co2({ model: "swd", version: 4 }).perByte(
    v.bytes,
    v.greenHosting,
  );
  if (!Number.isFinite(grams) || grams < 0)
    throw new Error("Invalid model result");
  return {
    grams,
    perUnit: v.workCount === undefined ? undefined : grams / v.workCount,
  };
}
