import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "ink-testing-library";
import { Input } from "../src/tui/components/Input.tsx";

afterEach(cleanup);

const ENTER = "\r";
const UP = "[A";
const DOWN = "[B";
const TAB = "\t";
// Ctrl+Backspace via the kitty keyboard protocol: backspace (cp 127) + ctrl (mod 5).
const CTRL_BACKSPACE = "\x1b[127;5u";
const CTRL_W = "\x17";

/** Let Ink flush a render after a keystroke. */
const tick = () => new Promise((r) => setTimeout(r, 10));

describe("Input / command menu", () => {
  test("typing '/' opens the selectable menu listing commands", async () => {
    const { stdin, lastFrame } = render(
      <Input mode="build" isActive onSubmit={() => {}} />,
    );
    stdin.write("/");
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("/plan");
    expect(frame).toContain("/exit");
    // The first item is highlighted with the selection caret.
    expect(frame).toContain("❯ /plan");
  });

  test("↓ moves the highlight; Enter runs the highlighted command", async () => {
    const submitted: string[] = [];
    const { stdin } = render(
      <Input mode="build" isActive onSubmit={(t) => submitted.push(t)} />,
    );
    stdin.write("/");
    await tick();
    stdin.write(DOWN); // /plan -> /build
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(submitted).toEqual(["/build"]);
  });

  test("Tab completes the highlighted command without submitting", async () => {
    const submitted: string[] = [];
    const { stdin, lastFrame } = render(
      <Input mode="build" isActive onSubmit={(t) => submitted.push(t)} />,
    );
    stdin.write("/m");
    await tick();
    stdin.write(TAB);
    await tick();
    expect(submitted).toEqual([]);
    expect(lastFrame() ?? "").toContain("/mode");
  });

  test("a typed prefix filters the list", async () => {
    const { stdin, lastFrame } = render(
      <Input mode="build" isActive onSubmit={() => {}} />,
    );
    stdin.write("/c");
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("/clear");
    // A non-matching command should be absent from the menu (/exit never
    // appears in the mode badge, unlike /plan|/build).
    expect(frame).not.toContain("/exit");
  });

  test("plain text submits as-is on Enter", async () => {
    const submitted: string[] = [];
    const { stdin } = render(
      <Input mode="build" isActive onSubmit={(t) => submitted.push(t)} />,
    );
    stdin.write("hello world");
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(submitted).toEqual(["hello world"]);
  });

  test("Ctrl+Backspace deletes the word before the cursor", async () => {
    const submitted: string[] = [];
    const { stdin } = render(
      <Input mode="build" isActive onSubmit={(t) => submitted.push(t)} />,
    );
    stdin.write("hello world");
    await tick();
    stdin.write(CTRL_BACKSPACE); // drop "world"
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(submitted).toEqual(["hello "]);
  });

  test("Ctrl+W deletes the word before the cursor", async () => {
    const submitted: string[] = [];
    const { stdin } = render(
      <Input mode="build" isActive onSubmit={(t) => submitted.push(t)} />,
    );
    stdin.write("foo bar");
    await tick();
    stdin.write(CTRL_W); // drop "bar"
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(submitted).toEqual(["foo "]);
  });

  test("↑ recalls history when no menu is open", async () => {
    const submitted: string[] = [];
    const { stdin } = render(
      <Input mode="build" isActive onSubmit={(t) => submitted.push(t)} />,
    );
    stdin.write("first");
    await tick();
    stdin.write(ENTER); // submit + record history
    await tick();
    stdin.write(UP); // recall "first"
    await tick();
    stdin.write(ENTER);
    await tick();
    expect(submitted.at(-1)).toBe("first");
  });
});
