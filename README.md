# Aerospace Layout Manager

Automate the arrangement of windows into complex, repeatable layouts using aerospace.

This project is a script that drives the excellent [`aerospace`](https://github.com/nikitabobko/AeroSpace) window-manager CLI.  
You describe a layout once (in JSON), then run the script whenever you need that workspace restored.

---

## ✨ Features

* Launches apps if they are not already running.
* Moves / focuses windows into the requested **workspace**.
* Supports nested horizontal & vertical groups for sophisticated tiling.
* Falls back to a configurable “stash” workspace so your primary workspace starts clean.
* One-line listing of all available layouts.

## 🔧 Configuration (`layouts.json`)

```json
{
  "stashWorkspace": "S",
  "layouts": {
    "work": {
      "workspace": "1",
      "layout": "v_tiles",
      "orientation": "vertical",
      "windows": [
        { "bundleId": "com.apple.Safari" },
        {
          "orientation": "horizontal",
          "windows": [
            { "bundleId": "com.jetbrains.WebStorm" },
            { "bundleId": "com.apple.Terminal" }
          ]
        }
      ]
    }
  }
}
```

Field reference:

* **stashWorkspace** – workspace whose windows will be used as temporary storage.
* **layouts** → each key is a layout name you can invoke.
  * **workspace** – target workspace (string or number) for the layout.
  * **layout** – one of Aerospace’s layout names (`tiles`, `h_tiles`, `v_tiles`, `floating`, …).
  * **orientation** – default orientation for nested groups (`horizontal` or `vertical`).
  * **windows** – recursive array of:
    * `{ "bundleId": "…"}`
    * `{ "orientation": "horizontal" \| "vertical", "windows": [ … ] }`

---

## ▶️  Usage

Install packages (there is only `typescript` for types, but we keep lock-files tidy):

```bash
bun install
```

### List available layouts

```bash
bun run index.ts --listLayouts
# or: bun run index.ts -L
```

### Apply a layout

```bash
# by long option
bun run index.ts --layout work

# by short option
bun run index.ts -l work

# or simply pass the name as a positional argument
bun run index.ts work
```

### Use an alternate config file

```bash
bun run index.ts --configFile ~/my-layouts/presentation.json -l keynote
```

---

## ⚙️  How it works (high level)

1. **Clear** – moves every window currently in the target workspace to `stashWorkspace`.
2. **Move** – ensures each app is running, then moves its first window into the layout’s workspace, depth-first.
3. **Reposition** – flattens the workspace, sets the requested layout type, and joins / splits panes according to the JSON hierarchy.
4. **Focus** – switches to the fully-arranged workspace.

The logic lives in [`index.ts`](./index.ts) and is intentionally kept readable if you need to tweak timings or behaviour.

---

## 🛠  Extending

* Add more layouts in `layouts.json`.
* Nest groups arbitrarily deep (`windows` can contain further groups).
* New window-management tricks? Wrap additional Aerospace CLI calls in `index.ts`.

PRs and ideas are welcome!
