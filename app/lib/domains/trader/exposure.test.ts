import { describe, expect, it } from "vitest";
import { worstCaseExposure } from "./exposure";

const held = (symbol: string, quantity: number, averagePrice = 100) => ({ symbol, quantity, averagePrice });
const work = (symbol: string, quantity: number) => ({ symbol, quantity });

describe("worstCaseExposure", () => {
  it("reports a held position when nothing is working", () => {
    expect(worstCaseExposure([held("A", 10)], [], 50)).toEqual([{ symbol: "A", quantity: 10, price: 100 }]);
  });

  it("adds a working buy to a held long", () => {
    expect(worstCaseExposure([held("A", 10)], [work("A", 5)], 50)[0].quantity).toBe(15);
  });

  it("reports a working order on a symbol held flat", () => {
    expect(worstCaseExposure([], [work("A", 7)], 50)).toEqual([{ symbol: "A", quantity: 7, price: 50 }]);
  });

  it("does NOT net a working close against the position it closes", () => {
    // The bug this function exists to fix. Netting reported zero, but the worst
    // case for the long limit is exactly that the close does not fill while a
    // new entry does.
    const [a] = worstCaseExposure([held("A", 10)], [work("A", -10)], 50);
    expect(a.quantity).toBe(10);
  });

  it("takes the larger magnitude when both sides are working", () => {
    // held +10, a working buy of 3 and a working sell of 20.
    //   worst long  = 13
    //   worst short = -10
    // 13 wins on magnitude.
    expect(worstCaseExposure([held("A", 10)], [work("A", 3), work("A", -20)], 50)[0].quantity).toBe(13);
  });

  it("reports the short side when it is the larger exposure", () => {
    // held -10 with a working sell of 5: worst short is -15.
    expect(worstCaseExposure([held("A", -10)], [work("A", -5)], 50)[0].quantity).toBe(-15);
  });

  it("values working-only exposure at the fallback price", () => {
    // Nothing has filled, so the broker has given us no average price.
    expect(worstCaseExposure([], [work("A", 4)], 77)[0].price).toBe(77);
  });

  it("values exposure at the broker's average once something is held", () => {
    expect(worstCaseExposure([held("A", 10, 123)], [work("A", 4)], 77)[0].price).toBe(123);
  });

  it("drops a symbol with no exposure on either side", () => {
    expect(worstCaseExposure([held("A", 0)], [], 50)).toEqual([]);
  });

  it("keeps symbols separate and sorted", () => {
    const out = worstCaseExposure([held("Z", 1)], [work("A", 2)], 50);
    expect(out.map((e) => e.symbol)).toEqual(["A", "Z"]);
  });

  it("handles nothing at all", () => {
    expect(worstCaseExposure([], [], 50)).toEqual([]);
  });
});
