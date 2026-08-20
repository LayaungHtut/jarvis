import { Tool } from './base';
import type { ToolInfo, PermissionLevel } from '../../src/lib/shared/types';
import { OpenApplicationTool, ListWindowsTool, GetActiveWindowTool } from './windows';
import { OpenGoogleAccountTool } from './google';
import { SystemInfoTool } from './system';
import { TerminalTool } from './terminal';
import { ReadFileTool, WriteFileTool, ListDirTool, DeleteFileTool } from './filesystem';
import { OpenCodeTool, OpenCodeAvailabilityTool } from './opencode';
import { ChatTool } from './chat';
import { ScreenshotTool } from './screenshot';
import { OpenUrlTool, SearchWebTool, ReadPageTool } from './browser';
import { RememberTool, RecallTool, RememberTaskTool } from './memory';
import {
	MouseMoveTool,
	MouseClickTool,
	TypeTextTool,
	PressKeyTool,
	ScrollTool
} from './automation';
import {
	GetVolumeTool,
	SetVolumeTool,
	AdjustVolumeTool,
	MediaControlTool,
	MediaPlayTool,
	NotifyTool,
	LockScreenTool
} from './media';
import {
	ListProcessesTool,
	KillProcessTool,
	FocusWindowTool,
	CloseWindowTool,
	MinimizeWindowTool
} from './process';
import {
	ClipboardReadTool,
	ClipboardWriteTool,
	CopyFileTool,
	MoveFileTool,
	ZipFolderTool,
	OpenPathTool
} from './files';
import { ObserveScreenTool } from './observe';
import { UiListTool, UiClickTool, UiSetTextTool } from './uia';
import {
	SearchFilesTool,
	SystemPowerTool,
	ListAppsTool,
	SystemServicesTool,
	GetEnvVarTool,
	SetEnvVarTool
} from './deep';
import type { AgentContext } from '../agent/context';

/**
 * ToolRegistry owns the list of tools the agent can invoke. It exposes the
 * schema for the LLM, filters tools by availability, and executes them with a
 * permission gate managed by the caller (the agent context).
 */
export class ToolRegistry {
	private readonly tools: Map<string, { tool: Tool; enabled: boolean }> = new Map();

	constructor() {
		this.registerAll();
	}

	private registerAll(): void {
		const tools: Tool[] = [
			new OpenApplicationTool(),
			new OpenGoogleAccountTool(),
			new ListWindowsTool(),
			new GetActiveWindowTool(),
			new SystemInfoTool(),
			new TerminalTool(),
			new ReadFileTool(),
			new WriteFileTool(),
			new ListDirTool(),
			new DeleteFileTool(),
			new OpenCodeTool(),
			new OpenCodeAvailabilityTool(),
			new ChatTool(),
			new ScreenshotTool(),
			new OpenUrlTool(),
			new SearchWebTool(),
			new ReadPageTool(),
			new RememberTool(),
			new RecallTool(),
			new RememberTaskTool(),
			new MouseMoveTool(),
			new MouseClickTool(),
			new TypeTextTool(),
			new PressKeyTool(),
			new ScrollTool(),
			new GetVolumeTool(),
			new SetVolumeTool(),
			new AdjustVolumeTool(),
			new MediaControlTool(),
			new MediaPlayTool(),
			new NotifyTool(),
			new LockScreenTool(),
			new ListProcessesTool(),
			new KillProcessTool(),
			new FocusWindowTool(),
			new CloseWindowTool(),
			new MinimizeWindowTool(),
			new ClipboardReadTool(),
			new ClipboardWriteTool(),
			new CopyFileTool(),
			new MoveFileTool(),
			new ZipFolderTool(),
			new OpenPathTool(),
			new ObserveScreenTool(),
			new UiListTool(),
			new UiClickTool(),
			new UiSetTextTool(),
			new SearchFilesTool(),
			new SystemPowerTool(),
			new ListAppsTool(),
			new SystemServicesTool(),
			new GetEnvVarTool(),
			new SetEnvVarTool()
		];
		for (const tool of tools) this.register(tool);
	}

	register(tool: Tool, enabled = true): void {
		this.tools.set(tool.name, { tool, enabled });
	}

	disable(name: string): void {
		const entry = this.tools.get(name);
		if (entry) entry.enabled = false;
	}

	enable(name: string): void {
		const entry = this.tools.get(name);
		if (entry) entry.enabled = true;
	}

	has(name: string): boolean {
		return this.tools.has(name);
	}

	list(): ToolInfo[] {
		return [...this.tools.values()]
			.filter((e) => e.enabled)
			.map((e) => ({
				name: e.tool.name,
				description: e.tool.description,
				permission_level: e.tool.permissionLevel,
				parameters: e.tool.parameters.map((p) => ({
					name: p.name,
					type: p.type,
					description: p.description
				}))
			}));
	}

	/** Tool schema suitable for OpenAI-style function declarations. */
	schema(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
		return this.list().map((t) => ({
			name: t.name,
			description: t.description,
			parameters: {
				type: 'object',
				properties: Object.fromEntries(
					t.parameters.map((p) => [p.name, { type: p.type, description: p.description }])
				),
				required: t.parameters
					.filter(
						(p) =>
							p.type === 'string' &&
							['application', 'account', 'path', 'command', 'url'].includes(p.name)
					)
					.map((p) => p.name)
			}
		}));
	}

	async execute(
		name: string,
		args: Record<string, unknown>,
		context: AgentContext
	): Promise<unknown> {
		const entry = this.tools.get(name);
		if (!entry) throw new Error(`Unknown tool: ${name}`);
		if (!entry.enabled) throw new Error(`Tool disabled: ${name}`);
		return entry.tool.execute(args ?? {}, context);
	}
}

export function defaultRegistry(): ToolRegistry {
	return new ToolRegistry();
}

export function permissionLevelForTool(name: string): PermissionLevel | null {
	const tool = new ToolRegistry();
	return tool.has(name)
		? (tool.list().find((t) => t.name === name)?.permission_level ?? null)
		: null;
}

void permissionLevelForTool;
