import { describe, expect, it } from "vitest";
import { compass, fmt, parseNumber } from "./format";

describe("format", () => {
  it("formats with Turkish separators", () => {
    expect(fmt(1234.5, 1)).toBe("1.234,5");
  });
  it("parses comma and dot decimals", () => {
    expect(parseNumber("2,278")).toBe(2.278);
    expect(parseNumber("2.278")).toBe(2.278);
    expect(parseNumber("1.234,5")).toBe(1234.5);
    expect(parseNumber("abc")).toBeNull();
  });
  it("names compass directions in Turkish", () => {
    expect(compass(180)).toBe("G");
    expect(compass(90)).toBe("D");
    expect(compass(350)).toBe("K");
  });
});
