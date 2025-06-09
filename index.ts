#!/usr/bin/env bun

import { $ } from "bun";
import { parseArgs } from "node:util";

// Types
type WorkspaceLayout = "h_tiles"|"v_tiles"|"h_accordion"|"v_accordion"|"tiles"|"accordion"|"horizontal"|"vertical"|"tiling"|"floating"
type Orientation = "horizontal" | "vertical";

type LayoutWindow = {
    bundleId: string;
}

type LayoutGroup = {
    orientation: Orientation;
    windows: LayoutWindow[];
}

type LayoutItem = LayoutWindow | LayoutGroup;

type Layout = {
    workspace: string;
    layout: WorkspaceLayout;
    orientation: Orientation;
    windows: LayoutItem[];
}

type LayoutConfig = {
    stashWorkspace: string;
    layouts: Record<string, Layout>;
}

// Setup

const args = parseArgs({
    args: process.argv.slice(2),
    options: {
        layout: { type: "string", short: "l" },
        configFile: { type: "string", short: "c", default: "~/.config/aerospace/layouts.json" },
        listLayouts: { type: "boolean", short: "L" },
    },
    strict: true,
    allowPositionals: true,
});

const layoutName = args.values.layout || args.positionals[0];
const configFilePath = await $`echo ${args.values.configFile}`.text();
const layoutConfig: LayoutConfig = await Bun.file(configFilePath.trim()).json();

if(args.values.listLayouts) {
    console.log(Object.keys(layoutConfig.layouts).join("\n"));
    process.exit(0);
}


if(!layoutName) {
    throw new Error("Layout is required");
}



const layout = layoutConfig.layouts[layoutName];
const stashWorkspace = layoutConfig.stashWorkspace ?? "S";

if(!layout) {
    throw new Error("Layout not found");
}

// Helpers


async function flattenWorkspace(workspace: string) {
    await $`aerospace flatten-workspace-tree --workspace ${workspace}`.nothrow();
}

async function switchToWorkspace(workspace: string) {
    await $`aerospace workspace ${workspace}`.nothrow();
}

async function moveWindow(windowId: string, workspace: string) {
    await $`aerospace move-node-to-workspace --window-id "${windowId}" "${workspace}" --focus-follows-window`;
}

async function getWindowsInWorkspace(workspace: string): Promise<{
    'app-name': string;
    'window-id': string;
    'window-title': string;
    'app-bundle-id': string;
}[]> {
    return await $`aerospace list-windows --workspace ${workspace} --json --format "%{window-id} %{app-name} %{window-title} %{app-bundle-id}"`.json();
}

async function joinItemWithPreviousWindow(windowId: string) {
    await $`aerospace join-with --window-id ${windowId} left`.nothrow();
}


async function focusWindow(windowId: string) {
    await $`aerospace focus --window-id ${windowId}`.nothrow();
}

// Functions


// remove all windows from workspace
async function clearWorkspace(workspace: string) {
    const windows = await getWindowsInWorkspace(workspace);

    for (const window of windows) {
        if(!!window['window-id']) {
            await moveWindow(window['window-id'], stashWorkspace);
        }
    }
}

async function getWindowId(bundleId: string) {
    const bundleJson = await $`aerospace list-windows --monitor all --app-bundle-id "${bundleId}" --json`.json();
    const windowId = bundleJson?.length > 0 ? bundleJson[0]["window-id"] : null;
    if(!windowId) {
        console.log("No windowId found for", bundleId);
    }
    return windowId;
}

async function launchIfNotRunning(bundleId: string) {
    const isRunning = await $`osascript -e "application id \"${bundleId}\" is running" | grep -q true`.text() === "true";
    if (!isRunning) {
        await $`open -b "${bundleId}"`;
    }
}

async function ensureWindow(bundleId: string) {
    await launchIfNotRunning(bundleId);
    for await (const i of Array(30)) {
        const windowId = await getWindowId(bundleId);
        if(windowId) {
            return windowId;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
}



async function setWorkspaceLayout(workspace: string, layout: WorkspaceLayout) {
    const workspaceWindows = await getWindowsInWorkspace(workspace);
    if(workspaceWindows.length > 0) {
        const windowId = workspaceWindows?.[0]?.['window-id'];
        await $`aerospace layout ${layout} --window-id ${windowId}`.nothrow();
    }
}

async function traverseTreeMove(tree: LayoutItem[], depth = 0, parent: LayoutGroup | null = null) {
    for await (const [i, item] of tree.entries()) {
        if ("bundleId" in item) {
            const windowId = await ensureWindow(item.bundleId);

            if(windowId) {
                await moveWindow(windowId, layout.workspace);
            }

         
        } else if ("windows" in item) {
            await traverseTreeMove(item.windows, depth + 1, item);
        }
    }
}


async function traverseTreeReposition(tree: LayoutItem[], depth = 0, parent: LayoutGroup | null = null) {
    for await (const [i, item] of tree.entries()) {
        if(depth === 0 && i === 0) {
            // set workspace layout after moving first window
            await flattenWorkspace(layout.workspace);
            await setWorkspaceLayout(layout.workspace, layout.layout);
        }
        if ("bundleId" in item) {
            if(depth > 0 && i > 0) {
                // subsequent windows in a group should be joined with the previous window
                const windowId = await getWindowId(item.bundleId);
                if(windowId) {
                    await focusWindow(windowId);
                    await joinItemWithPreviousWindow(windowId);
                }

            }
         
        } else if ("windows" in item) {
            console.log("section:", item.orientation, "depth:", depth);
            await traverseTreeReposition(item.windows, depth + 1, item);
        }
    }
}


// Main
await clearWorkspace(layout.workspace);
await traverseTreeMove(layout.windows);
await traverseTreeReposition(layout.windows);
await switchToWorkspace(layout.workspace);
