import { describe, expect, test } from "bun:test";
import { cleanAddressInput, initialTitle, isScaffoldTitle } from "../src/features/project/deploy";
import {
  base64Bytes,
  bytesToBase64,
  containRect,
  stripDataUri,
} from "../src/features/project/logoImage";

// The parts of "Name and logo" that are not a browser: what the Name field
// opens on, and the arithmetic that turns a picked picture into two PNGs.

describe("what the Name field opens on", () => {
  test("a scaffold title gives way to the project's name", () => {
    for (const title of [null, "", "vite-react-ts", "Vite + React + TS", "Vite App", "React App", "tau", "Untitled"]) {
      expect(isScaffoldTitle(title)).toBe(true);
      expect(initialTitle({ title, projectName: "Kurinji Leaf" })).toBe("Kurinji Leaf");
    }
  });

  test("a title the owner or the agent chose is kept", () => {
    for (const title of ["Kurinji Leaf", "Night Orchard · Eau de parfum", "Reactive Labs"]) {
      expect(isScaffoldTitle(title)).toBe(false);
      expect(initialTitle({ title, projectName: "something else" })).toBe(title);
    }
  });
});

describe("fitting a picture into a square", () => {
  test("a wide picture is centred with bars above and below, not stretched", () => {
    expect(containRect(200, 100, 64)).toEqual({ x: 0, y: 16, w: 64, h: 32 });
  });

  test("a tall one is centred with bars at the sides", () => {
    expect(containRect(100, 200, 64)).toEqual({ x: 16, y: 0, w: 32, h: 64 });
  });

  test("a square fills it, and a small one is scaled up", () => {
    expect(containRect(512, 512, 64)).toEqual({ x: 0, y: 0, w: 64, h: 64 });
    expect(containRect(16, 16, 64)).toEqual({ x: 0, y: 0, w: 64, h: 64 });
  });

  // An SVG with no width and height reports zero.
  test("a picture with no size is drawn as a square", () => {
    expect(containRect(0, 0, 64)).toEqual({ x: 0, y: 0, w: 64, h: 64 });
  });
});

describe("base64", () => {
  test("round-trips bytes, including a file too big to spread into one call", () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 251);
    const b64 = bytesToBase64(bytes);

    expect(base64Bytes(b64)).toBe(bytes.length);
    expect([...Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))].slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
  });

  test("sizes padded strings exactly", () => {
    expect(base64Bytes(btoa("a"))).toBe(1);
    expect(base64Bytes(btoa("ab"))).toBe(2);
    expect(base64Bytes(btoa("abc"))).toBe(3);
  });

  test("takes the payload out of a data URI, and leaves a bare one alone", () => {
    expect(stripDataUri("data:image/png;base64,AAAA")).toBe("AAAA");
    expect(stripDataUri("AAAA")).toBe("AAAA");
  });
});

describe("what can be typed as an address", () => {
  test("lowercases, and turns anything else into a hyphen", () => {
    expect(cleanAddressInput("My Cool App")).toBe("my-cool-app");
    expect(cleanAddressInput("kurinji_leaf!")).toBe("kurinji-leaf-");
    expect(cleanAddressInput("Ünï")).toBe("-n-");
  });

  test("collapses repeated hyphens and stops at 40 characters", () => {
    expect(cleanAddressInput("a---b")).toBe("a-b");
    expect(cleanAddressInput("x".repeat(60))).toHaveLength(40);
  });

  test("leaves a valid address alone", () => {
    expect(cleanAddressInput("my-app-2")).toBe("my-app-2");
  });
});
