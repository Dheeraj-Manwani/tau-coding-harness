# Components guide — using the shadcn components in this app

The components in `src/components/ui/` are shadcn's, built on **Base UI** (`@base-ui/react`), not Radix. Most of what you remember about shadcn still holds. These are the differences that cause errors — follow them rather than reading the component files or `node_modules` to work it out.

## There is no `asChild`. Use `render`.
To make one component render as another element, pass the element to `render`. The children stay where they are.

```tsx
<DialogTrigger render={<Button variant="outline" />}>Edit profile</DialogTrigger>
<TooltipTrigger render={<Button size="icon" variant="ghost" />}><Info /></TooltipTrigger>
<DropdownMenuTrigger render={<Button variant="outline" />}>Options</DropdownMenuTrigger>
<DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
```

A button that is really a link needs `nativeButton={false}` as well, because what it renders is no longer a `<button>`:

```tsx
<Button render={<Link to="/menu" />} nativeButton={false}>See the menu</Button>
<Button render={<a href="https://example.com" />} nativeButton={false}>Visit</Button>
```

## Select shows the raw value unless it is given the labels
`<SelectValue />` prints the selected `value` as it is — `"lg"`, not "Large loaf". Give the `Select` its `items` and it prints the label instead. An entry whose value is `null` is the placeholder.

```tsx
const SIZES = [
  { label: "Choose a size", value: null },
  { label: "Small loaf", value: "s" },
  { label: "Large loaf", value: "l" },
]

const [size, setSize] = useState<string | null>(null)

<Select items={SIZES} value={size} onValueChange={(v) => setSize(v)}>
  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
  <SelectContent>
    {SIZES.filter((s) => s.value !== null).map((s) => (
      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
    ))}
  </SelectContent>
</Select>
```

- The value can be `null` (nothing chosen), so type the state `string | null`.
- `SelectTrigger` is only as wide as its content; add `className="w-full"` inside a form.
- With no `items`, `<SelectValue placeholder="Choose a size" />` still shows a placeholder, but a chosen value prints raw.

## Handlers and state
- `Checkbox` and `Switch`: `checked` and `onCheckedChange={(checked) => …}`, where `checked` is a boolean.
- `Tabs`, `RadioGroup`: `value` and `onValueChange={(value) => …}`.
- `Slider`: a single thumb takes a number — `value={n}` and `onValueChange={(v) => setN(v as number)}`.
- `Dialog`, `Sheet`, `Popover`, `DropdownMenu`: uncontrolled by default; to control one, `open` and `onOpenChange`.

## Styling by state
State is exposed as data attributes, and Tailwind has a variant for each: `data-open:`, `data-closed:`, `data-checked:`, `data-unchecked:`, `data-active:` (the selected tab), `data-disabled:`, `data-horizontal:`, `data-vertical:`. Do not write `data-[state=open]:`; nothing sets `data-state` here.

## Other things worth knowing
- `Button` has variants `default`, `outline`, `secondary`, `ghost`, `destructive`, `link` and sizes `xs`, `sm`, `default`, `lg`, `icon`, `icon-sm`, `icon-lg`. An icon placed inside a button is sized for you.
- `Card` is `Card` → `CardHeader` (`CardTitle`, `CardDescription`, `CardAction`) → `CardContent` → `CardFooter`. `<Card size="sm">` is the compact form.
- `Badge` variants: `default`, `secondary`, `outline`, `destructive`, `ghost`.
- `Tabs`: `<TabsList variant="line">` is available, but the app's skin already decides how tabs look.
- A `<Toaster />` and a `<TooltipProvider>` are mounted in `src/main.tsx`. Call `toast("Saved")` from `sonner`; use `<Tooltip>` without wrapping it.
- Import `cn` from `@/lib/utils`.
- How these components *look* is set by the skin in `src/index.css`, not by classes where you use them.
