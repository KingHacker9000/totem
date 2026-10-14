import { checkObject } from "./state.mjs";

// Physical backlight control is separate from the avatar's sleeping animation.
export async function setDisplayPower(args, recover) {
  checkObject(args, ["sleep"]);
  if (typeof args.sleep !== "boolean") throw new Error("sleep must be boolean");
  await recover(args.sleep ? "screen:off" : "screen:on");
  return { ok: true, sleeping: args.sleep };
}
