import assert from "node:assert/strict";
import { test } from "node:test";
import { context, displayTarget } from "./context.mjs";

test("context returns useful connector summaries without credentials or large chart series", () => {
  const value = context(
    {
      catalog: [
        {
          id: "calendar",
          health: "err",
          detail: "Sign-in required",
          token: "secret",
        },
      ],
      widgets: [
        {
          id: "swinglab:portfolios",
          data: {
            access_token: "secret",
            topPortfolios: [
              {
                id: "one",
                name: "Portfolio",
                currentValue: 12,
                ranges: { private: "secret" },
              },
            ],
          },
        },
      ],
    },
    { focus: { id: "existing" } },
  );
  assert.equal(value.focus.id, "existing");
  assert.equal(value.connectors[0].detail, "Sign-in required");
  assert.equal(value.widgets[0].data.topPortfolios[0].currentValue, 12);
  assert.ok(!JSON.stringify(value).includes("secret"));
});
test("navigation accepts enabled installed targets and rejects paths, disabled apps and extra keys", () => {
  const nav = {
    catalog: [
      { id: "academic", enabled: true, implemented: true, app: true },
      { id: "disabled", enabled: false, implemented: true, app: true },
    ],
    widgets: [{ id: "academic:due-this-week", connectorId: "academic" }],
  };
  for (const target of [
    "home",
    "launcher",
    "academic",
    "academic:due-this-week",
  ])
    assert.equal(displayTarget({ target }, nav), target);
  for (const args of [
    { target: "disabled" },
    { target: "https://example.com" },
    { target: "../../etc/passwd" },
    { target: "home", url: "evil" },
  ])
    assert.throws(() => displayTarget(args, nav));
});
