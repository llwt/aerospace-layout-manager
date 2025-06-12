#!/usr/bin/env bun

import { $ } from "bun";
import { parseArgs } from "node:util";

// Types
type WorkspaceLayout =
	| "h_tiles"
	| "v_tiles"
	| "h_accordion"
	| "v_accordion"
	| "tiles"
	| "accordion"
	| "horizontal"
	| "vertical"
	| "tiling"
	| "floating";
type Orientation = "horizontal" | "vertical";
type Size = `${number}/${number}`;
interface LayoutWindow {
	bundleId: string;
}

interface LayoutWindowWithSize extends LayoutWindow {
	size: Size;
}

interface LayoutGroup {
	orientation: Orientation;
	windows: LayoutWindow[];
}

interface LayoutGroupWithSize extends LayoutGroup {
	size: Size;
}

type LayoutItem =
	| LayoutWindow
	| LayoutGroup
	| LayoutWindowWithSize
	| LayoutGroupWithSize;

type Layout = {
	workspace: string;
	layout: WorkspaceLayout;
	orientation: Orientation;
	windows: LayoutItem[];
};

type LayoutConfig = {
	stashWorkspace: string;
	layouts: Record<string, Layout>;
};

// Setup

const args = parseArgs({
	args: process.argv.slice(2),
	options: {
		layout: { type: "string", short: "l" },
		configFile: {
			type: "string",
			short: "c",
			default: "~/.config/aerospace/layouts.json",
		},
		listLayouts: { type: "boolean", short: "L" },
		help: { type: "boolean", short: "h" },
	},
	strict: true,
	allowPositionals: true,
});

const layoutName = args.values.layout || args.positionals[0];
const configFilePath = await $`echo ${args.values.configFile}`.text();
const layoutConfig: LayoutConfig = await Bun.file(configFilePath.trim()).json();

if (args.values.listLayouts) {
	console.log(Object.keys(layoutConfig.layouts).join("\n"));
	process.exit(0);
}

function printHelp() {
	console.log(
		`\nAerospace Layout Manager\n\nUsage:\n  aerospace-layout-manager [options] <layout-name>\n\nOptions:\n  -l, --layout <layout-name>   Specify the layout name (can also be provided as the first positional argument)\n  -c, --configFile <path>      Path to the layout configuration file (default: ~/.config/aerospace/layouts.json)\n  -L, --listLayouts            List available layout names from the configuration file\n  -h, --help                   Show this help message and exit\n\nExamples:\n  # Apply the 'work' layout defined in the config\n  aerospace-layout-manager work\n\n  # Same as above using the explicit flag\n  aerospace-layout-manager --layout work\n\n  # List all available layouts\n  aerospace-layout-manager --listLayouts\n`,
	);
}

// Show help and exit if requested explicitly
if (args.values.help || layoutName === "help") {
	printHelp();
	process.exit(0);
}

if (!layoutName) {
	printHelp();
	process.exit(0);
}

const layout = layoutConfig.layouts[layoutName];
const stashWorkspace = layoutConfig.stashWorkspace ?? "S";

if (!layout) {
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

async function getWindowsInWorkspace(workspace: string): Promise<
	{
		"app-name": string;
		"window-id": string;
		"window-title": string;
		"app-bundle-id": string;
	}[]
> {
	return await $`aerospace list-windows --workspace ${workspace} --json --format "%{window-id} %{app-name} %{window-title} %{app-bundle-id}"`.json();
}

async function joinItemWithPreviousWindow(windowId: string) {
	await $`aerospace join-with --window-id ${windowId} left`.nothrow();
}

async function focusWindow(windowId: string) {
	await $`aerospace focus --window-id ${windowId}`.nothrow();
}

/**
 * Return the width of the current (primary) monitor in pixels.
 * Uses AppleScript because Aerospace does not expose this information.
 */
async function getMonitorWidth(): Promise<number | null> {
	try {
		/*
      AppleScript:  bounds of window of desktop -> {x1, y1, x2, y2}
      Width  = x2 - x1
    */
		const output =
			await $`osascript -e 'tell application "Finder" to get bounds of window of desktop'`.text();
		const parts = output
			.split(/,\s*/) // split into ["0", "0", "1440", "900"]
			.map((v) => Number.parseInt(v.trim(), 10))
			.filter((n) => !Number.isNaN(n));

		if (parts.length === 4) {
			const [x1, , x2] = parts;
			return x2 - x1;
		}
		return null;
	} catch (error) {
		console.error("Unable to determine monitor width", error);
		return null;
	}
}

async function getMonitorHeight(): Promise<number | null> {
    try {
        const output = await $`osascript -e 'tell application "Finder" to get bounds of window of desktop'`.text();
        const parts = output.split(/,\s*/).map(v => Number.parseInt(v.trim(), 10)).filter(n => !Number.isNaN(n));
        if(parts.length === 4) {
            const [, y1, , y2] = parts;
            return y2 - y1;
        }
        return null;
    } catch (error) {
        console.error("Unable to determine monitor height", error);
        return null;
    }
}

// Functions

// remove all windows from workspace
async function clearWorkspace(workspace: string) {
	const windows = await getWindowsInWorkspace(workspace);

	for (const window of windows) {
		if (window["window-id"]) {
			await moveWindow(window["window-id"], stashWorkspace);
		}
	}
}

async function getWindowId(bundleId: string) {
	const bundleJson =
		await $`aerospace list-windows --monitor all --app-bundle-id "${bundleId}" --json`.json();
	const windowId = bundleJson?.length > 0 ? bundleJson[0]["window-id"] : null;
	if (!windowId) {
		console.log("No windowId found for", bundleId);
	}
	return windowId;
}

async function launchIfNotRunning(bundleId: string) {
	const isRunning =
		(await $`osascript -e "application id \"${bundleId}\" is running" | grep -q true`.text()) ===
		"true";
	if (!isRunning) {
		await $`open -b "${bundleId}"`;
	}
}

async function ensureWindow(bundleId: string) {
	await launchIfNotRunning(bundleId);
	for await (const i of Array(30)) {
		const windowId = await getWindowId(bundleId);
		if (windowId) {
			return windowId;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return null;
}

async function setWorkspaceLayout(workspace: string, layout: WorkspaceLayout) {
	const workspaceWindows = await getWindowsInWorkspace(workspace);
	if (workspaceWindows.length > 0) {
		const windowId = workspaceWindows?.[0]?.["window-id"];
		await $`aerospace layout ${layout} --window-id ${windowId}`.nothrow();
	}
}

async function traverseTreeMove(tree: LayoutItem[], depth = 0) {
	for await (const [i, item] of tree.entries()) {
		if ("bundleId" in item) {
			const windowId = await ensureWindow(item.bundleId);

			if (windowId) {
				await moveWindow(windowId, layout.workspace);
			}
		} else if ("windows" in item) {
			await traverseTreeMove(item.windows, depth + 1);
		}
	}
}

async function traverseTreeReposition(tree: LayoutItem[], depth = 0) {
	for await (const [i, item] of tree.entries()) {
		if (depth === 0 && i === 0) {
			// set workspace layout after moving first window
			await flattenWorkspace(layout.workspace);
			await setWorkspaceLayout(layout.workspace, layout.layout);
		}
		if ("bundleId" in item) {
			if (depth > 0 && i > 0) {
				// subsequent windows in a group should be joined with the previous window
				const windowId = await getWindowId(item.bundleId);
				if (windowId) {
					await focusWindow(windowId);
					await joinItemWithPreviousWindow(windowId);
				}
			}
		} else if ("windows" in item) {
			console.log("section:", item.orientation, "depth:", depth);
			await traverseTreeReposition(item.windows, depth + 1);
		}
	}
}

async function resizeWindow(windowId: string, size: Size, dimension: "width" | "height") {
    console.log("Resizing window", windowId, "to", size);
	const screenDimension = dimension === "width" ? await getMonitorWidth() : await getMonitorHeight();
	const [numerator, denominator] = size.split("/").map(Number);
    console.log("Screen dimension:", screenDimension);
    console.log("Numerator:", numerator);
    console.log("Denominator:", denominator);
	if (!screenDimension || !numerator || !denominator) {
		console.error("Unable to determine monitor width");
		return;
	}
	const newWidth = screenDimension * (numerator / denominator);
    console.log("New width:", newWidth);
    console.log("Command:", `aerospace resize --window-id ${windowId} ${dimension} ${newWidth}`);
	await $`aerospace resize --window-id ${windowId} ${dimension} ${newWidth}`.nothrow();
}

function getDimension(item: LayoutItem) {
    console.log("Item:", item);
    if("orientation" in item) {
        return item.orientation === "horizontal" ? "width" : "height";
    }
    return layout.orientation === "horizontal" ? "width" : "height";
}

async function traverseTreeResize(
	tree: LayoutItem[],
	depth = 0,
    parent: LayoutItem | null = null
) {
	for await (const [i, item] of tree.entries()) {
		if ("size" in item && "bundleId" in item) {
            const windowId = await getWindowId(item.bundleId);
       
            const dimension = getDimension(parent ?? item);
			await resizeWindow(windowId, item.size, dimension);
		} else if ("windows" in item) {
			const firstChildWindow = item.windows[0];
            console.log("Parent:", parent, "Item:", item);
            console.log("First child window:", firstChildWindow);
			if (
				"size" in item &&
				firstChildWindow &&
				"bundleId" in firstChildWindow
			) {
                console.log("Resizing first child window:", firstChildWindow.bundleId, "to", item.size);
                const windowId = await getWindowId(firstChildWindow.bundleId);
                const dimension = parent ? getDimension(parent) : layout.orientation === "horizontal" ? "width" : "height";
				await resizeWindow(windowId, item.size, dimension);
			}
			await traverseTreeResize(item.windows, depth + 1, item);
		}
	}
}

// Main
await clearWorkspace(layout.workspace);
await traverseTreeMove(layout.windows);
await traverseTreeReposition(layout.windows);
await switchToWorkspace(layout.workspace);
await traverseTreeResize(layout.windows);
