import { describe, expect, test } from "bun:test";
import { computeHeroPositions } from "./hero-layout";
import type { GraphNode } from "@/lib/queries/graph";

const owner: GraphNode = {
  id: "owner",
  displayName: "Owner",
  company: "Acme",
  isOwner: true,
  degree: 5,
};

function person(id: string, company: string | null): GraphNode {
  return {
    id,
    displayName: id,
    company,
    isOwner: false,
    degree: 1,
  };
}

describe("hero-layout", () => {
  test("ISC-1: returns one point per node with {id, x, y}", () => {
    const nodes = [owner, person("a", "Acme"), person("b", "Beta")];
    const pts = computeHeroPositions(nodes, [], {});
    expect(pts).toHaveLength(3);
    for (const p of pts) {
      expect(typeof p.id).toBe("string");
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  test("ISC-3: deterministic — same input produces byte-identical output", () => {
    const nodes = [
      owner,
      person("a", "Acme"),
      person("b", "Acme"),
      person("c", "Beta"),
      person("d", null),
    ];
    const a = JSON.stringify(computeHeroPositions(nodes, [], {}));
    const b = JSON.stringify(computeHeroPositions(nodes, [], {}));
    expect(a).toBe(b);
  });

  test("ISC-3: input order independence — sorting groups is stable", () => {
    const set1 = [owner, person("a", "Acme"), person("c", "Beta")];
    const set2 = [person("c", "Beta"), owner, person("a", "Acme")];
    const a = computeHeroPositions(set1, [], {});
    const b = computeHeroPositions(set2, [], {});
    // Both must place "a" at the same coordinate (Acme cluster, hash of "a")
    const ax = a.find((p) => p.id === "a")!;
    const bx = b.find((p) => p.id === "a")!;
    expect(ax).toEqual(bx);
  });

  test("ISC-5: positions are clamped inside the viewBox", () => {
    const nodes = [owner];
    for (let i = 0; i < 60; i++) {
      nodes.push(person(`p${i}`, i % 5 === 0 ? null : `Co${i % 5}`));
    }
    const pts = computeHeroPositions(nodes, [], { width: 1000, height: 600 });
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1000);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(600);
    }
  });

  test("ISC-2: owner sits at the centre", () => {
    const nodes = [owner, person("a", "Acme")];
    const pts = computeHeroPositions(nodes, [], { width: 1000, height: 600 });
    const o = pts.find((p) => p.id === "owner")!;
    expect(o.x).toBe(500);
    expect(o.y).toBe(300);
  });
});
