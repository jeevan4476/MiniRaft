import { describe, expect, test } from "bun:test";
import { StrokeSchema } from "../../types";
import { createStroke } from "../helpers";

describe("StrokeSchema", () => {
  test("accepts a valid stroke", () => {
    const result = StrokeSchema.parse(createStroke());

    expect(result.color).toBe("#000000");
  });

  test("rejects an invalid stroke payload", () => {
    expect(() =>
      StrokeSchema.parse({
        ...createStroke(),
        x0: "not-a-number",
      }),
    ).toThrow();
  });
});
