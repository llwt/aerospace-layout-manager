import { $ } from "bun";

// Types
type WorkspaceLayout = "h_tiles"|"v_tiles"|"h_accordion"|"v_accordion"|"tiles"|"accordion"|"horizontal"|"vertical"|"tiling"|"floating"
type Orientation = "horizontal" | "vertical";

type LayoutWindow = {
    bundleId: string;
    size: number;
}

type LayoutGroup = {
    size: number;
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

const stashWorkspace = "5";
const layout1:Layout = {
    workspace: "2",
    layout: "h_tiles",
    orientation: "horizontal",
    windows: [
    {
        bundleId: "md.obsidian",
        size: 1/3,
    },
    {
        size: 1/3,
        orientation: "vertical",
        windows: [
            {
                bundleId: "us.zoom.xos",
                size: 1/2,
            },
            {
                bundleId: "com.apple.Terminal",
                size: 1/2,
            }
        ]
    },
    {
        bundleId: "com.cron.electron",
        size: 1/3,
    }
]
}

const layout2:Layout = {
    workspace: "2",
    layout: "h_tiles",
    orientation: "horizontal",
    windows: [
    {
        bundleId: "md.obsidian",
        size: 2/3,
    },
    {
        bundleId: "com.cron.electron",
        size: 1/3,
    }
]
}

const layout = layout2
// Initialization
const width: number = Number(await $`system_profiler SPDisplaysDataType | awk '/Resolution/{print $2}'`.text())
const height: number = Number(await $`system_profiler SPDisplaysDataType | awk '/Resolution/{print $4}'`.text())

console.log("width:", width, "height:", height);

// Helper Functions
function getSize(size: number, orientation: Orientation) {
    if (orientation === "horizontal") {
        return size * width;
    } else {
        return size * height;
    }
}


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


async function moveWindow(windowId: string, workspace: string) {
    await $`aerospace move-node-to-workspace --window-id "${windowId}" "${workspace}" --focus-follows-window`;
}

type WindowListing = {
    'app-name': string;
    'window-id': string;
    'window-title': string;
    'app-bundle-id': string;
}

async function getWindowsInWorkspace(workspace: string): Promise<WindowListing[]> {
    return await $`aerospace list-windows --workspace ${workspace} --json --format "%{window-id} %{app-name} %{window-title} %{app-bundle-id}"`.json();
}

async function joinWithPreviousWindow(windowId: string) {
    await $`aerospace join-with --window-id ${windowId} left`.nothrow();
}


async function handleLayoutWindow(window: LayoutWindow, previousWindow?: LayoutWindow) {
    console.log("launching", window.bundleId);


    const windowId = await ensureWindow(window.bundleId);
    console.log("windowId:", windowId);
    if(windowId) {
        await moveWindow(windowId, layout.workspace);
        // await new Promise(resolve => setTimeout(resolve, 1000));

        // join with previous window if it exists
        if(previousWindow?.bundleId) {
            const previousWindowId = await getWindowId(previousWindow?.bundleId);
            if(previousWindowId) {
                await joinWithPreviousWindow(windowId);
            }
        }
    }
    // await new Promise(resolve => setTimeout(resolve, 1000));

}

// intentially not await
async function resizeWindow(windowId: string, size: number, orientation: Orientation) {
    const newSize = getSize(size, orientation);
    console.log(`resizing window ${windowId} to ${newSize}`);
    $`aerospace resize --window-id ${windowId} smart ${newSize}`;
}

async function traverseTree(tree: LayoutItem[], depth: number = 0, parent: LayoutGroup | null = null) {
    for await (const [i, item] of tree.entries()) {
        if ("bundleId" in item) {
            console.log("item:", item, "depth:", depth, "parent:", parent, "i:", i);
            if(depth > 0 && i > 0) {
                const previousWindow = parent?.windows[i-1];
                console.log(`joining ${item.bundleId} with ${previousWindow?.bundleId}`);

                await handleLayoutWindow(item, previousWindow);
            } else {
                await handleLayoutWindow(item);
            }
            if(depth === 0 && i === 0) {
                // set workspace layout after moving first window
                await setWorkspaceLayout(layout.workspace, layout.layout);
            }
        } else if ("windows" in item) {
            console.log("section:", item.orientation, "depth:", depth);
            await traverseTree(item.windows, depth + 1, item);
        }
    }
}

// runs after all windows are moved to the workspace
async function traverseTreeResize(tree: LayoutItem[], depth: number = 0, parent: LayoutGroup | null = null) {
    for await (const [i, item] of tree.entries()) {
        if ("bundleId" in item) {
            const windowId = await getWindowId(item.bundleId);
            if(windowId) {

                if(parent) {
                    await resizeWindow(item.bundleId, item.size, parent.orientation);
                } else {
                    await resizeWindow(item.bundleId, item.size, layout.orientation);
                }
            }
        } else if ("windows" in item) {
            console.log("section:", item.orientation, "depth:", depth);
            await traverseTree(item.windows, depth + 1, item);
        }
    }
}

async function setWorkspaceLayout(workspace: string, layout: WorkspaceLayout) {
    const workspaceWindows = await getWindowsInWorkspace(workspace);
    console.log("workspaceWindows:", workspaceWindows);
    if(workspaceWindows.length > 0) {
        const windowId = workspaceWindows?.[0]?.['window-id'];
        console.log("setting workspace layout to", layout, "for window", windowId);
    }
}

async function flattenWorkspace(workspace: string) {
    await $`aerospace flatten-workspace-tree --workspace ${workspace}`.nothrow();
}

async function switchToWorkspace(workspace: string) {
    await $`aerospace workspace ${workspace}`.nothrow();
}

// todo: will fail to set layout if there are no windows in the workspace
await clearWorkspace(layout.workspace);
await switchToWorkspace(layout.workspace);
await flattenWorkspace(layout.workspace);
await traverseTree(layout.windows);
await traverseTreeResize(layout.windows);

await switchToWorkspace(layout.workspace);