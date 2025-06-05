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
        configFile: { type: "string", short: "c", default: "layouts.json" }, // todo: add actual config location
    },
    strict: true,
    allowPositionals: true,
});

const layoutName = args.values.layout || args.positionals[0];


if(!layoutName) {
    throw new Error("Layout is required");
}


const layoutConfig: LayoutConfig = await Bun.file(args.values.configFile).json();
const layout = layoutConfig.layouts[layoutName];
const stashWorkspace = layoutConfig.stashWorkspace;

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
    console.log("windows:", windows);

    for (const window of windows) {
        if(!!window['window-id']) {
            await moveWindow(window['window-id'], stashWorkspace);
            console.log("moved window", window['window-id'], "to stash");
        }
    }
}

async function getWindowId(bundleId: string) {
    const bundleJson = await $`aerospace list-windows --monitor all --app-bundle-id "${bundleId}" --json`.json();
    console.log("bundleJson for", bundleId, ":", bundleJson);
    const windowId = bundleJson?.length > 0 ? bundleJson[0]["window-id"] : null;
    if(!windowId) {
        console.log("no windowId found for", bundleId);
    }
    return windowId;
}

async function launchIfNotRunning(bundleId: string) {
    const isRunning = await $`osascript -e "application id \"${bundleId}\" is running" | grep -q true`.text() === "true";
    console.log("isRunning:", isRunning);
    if (!isRunning) {
        await $`open -b "${bundleId}"`;
    }
}

async function ensureWindow(bundleId: string) {
    await launchIfNotRunning(bundleId);
    for await (const i of Array(10)) {
        const windowId = await getWindowId(bundleId);
        if(windowId) {
            return windowId;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return null;
}



async function setWorkspaceLayout(workspace: string, layout: WorkspaceLayout) {
    const workspaceWindows = await getWindowsInWorkspace(workspace);
    console.log("workspaceWindows:", workspaceWindows);
    if(workspaceWindows.length > 0) {
        const windowId = workspaceWindows?.[0]?.['window-id'];
        console.log("setting workspace layout to", layout, "for window", windowId);
        await $`aerospace layout ${layout} --window-id ${windowId}`.nothrow();
    }
}

async function traverseTreeMove(tree: LayoutItem[], depth = 0, parent: LayoutGroup | null = null) {
    for await (const [i, item] of tree.entries()) {
        if ("bundleId" in item) {
            console.log("item:", item, "depth:", depth, "parent:", parent, "i:", i);
            
            const windowId = await ensureWindow(item.bundleId);

            if(windowId) {
                await moveWindow(windowId, layout.workspace);
            }

         
        } else if ("windows" in item) {
            console.log("section:", item.orientation, "depth:", depth);
            await traverseTreeMove(item.windows, depth + 1, item);
        }
    }
}


async function traverseTreeReposition(tree: LayoutItem[], depth = 0, parent: LayoutGroup | null = null) {
    for await (const [i, item] of tree.entries()) {
        console.log("item:", item, "depth:", depth, "parent:", parent, "i:", i);
        if(depth === 0 && i === 0) {
            // set workspace layout after moving first window
            await flattenWorkspace(layout.workspace);
            await setWorkspaceLayout(layout.workspace, layout.layout);
        }
        if ("bundleId" in item) {
            if(depth > 0 && i > 0) {
                // subsequent windows in a group should be joined with the previous window
                const windowId = await getWindowId(item.bundleId);
                console.log(`to be joined with previous window: ${item.bundleId}`);
                if(windowId) {
                    console.log(`joining ${item.bundleId} with previous window`);
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
// await switchToWorkspace(layout.workspace);
await traverseTreeMove(layout.windows);
await traverseTreeReposition(layout.windows);
await switchToWorkspace(layout.workspace);
