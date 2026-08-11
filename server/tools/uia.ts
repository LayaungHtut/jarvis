import { Tool, ok, fail, requireString } from './base';
import type { ToolResult } from './base';
import type { AgentContext } from '../agent/context';
import { runPs } from './ps';

const GET_FG = `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class UiWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@;`;

const CLICK_CS = `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class UiClick {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}
"@;`;

const LIST_SCRIPT = `
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
${GET_FG}
$h = [UiWin]::GetForegroundWindow()
if ($h -eq [IntPtr]::Zero) { '[]'; exit }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($h)
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$results = New-Object System.Collections.ArrayList
$script:maxDepth = 6
$script:maxCount = 300
function Walk($el, $depth) {
  if ($results.Count -ge $script:maxCount) { return }
  if ($depth -gt $script:maxDepth) { return }
  try {
    $r = $el.Current.BoundingRectangle
    $n = $el.Current.Name
    if ($r.Width -gt 0 -and $r.Height -gt 0) {
      $t = $el.Current.ControlType.ProgrammaticName -replace '^ControlType\\.',''
      [void]$results.Add([pscustomobject]@{
        name = $n
        type = $t
        id = $el.Current.AutomationId
        x = [int]$r.X
        y = [int]$r.Y
        w = [int]$r.Width
        h = [int]$r.Height
      })
    }
  } catch { }
  $child = $walker.GetFirstChild($el)
  while ($child -ne $null) {
    Walk $child ($depth + 1)
    $child = $walker.GetNextSibling($child)
  }
}
Walk $root 0
if ($results.Count -eq 0) { '[]' } else { $results | ConvertTo-Json -Depth 5 -Compress }
`;

const FIND_TEMPLATE = `
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
${GET_FG}
${CLICK_CS}
$h = [UiWin]::GetForegroundWindow()
if ($h -eq [IntPtr]::Zero) { 'NO_WINDOW'; exit }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($h)
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$script:target = '__TARGET__'
$script:hit = $null
function Find($el, $depth) {
  if ($script:hit) { return }
  if ($depth -gt 8) { return }
  try {
    $r = $el.Current.BoundingRectangle
    $n = $el.Current.Name
    if ($r.Width -gt 0 -and $r.Height -gt 0 -and $n -like "*$script:target*") {
      $script:hit = $el
      $script:cx = [int]($r.X + $r.Width / 2)
      $script:cy = [int]($r.Y + $r.Height / 2)
      return
    }
    $child = $walker.GetFirstChild($el)
    while ($child -ne $null) {
      Find $child ($depth + 1)
      $child = $walker.GetNextSibling($child)
    }
  } catch { }
}
`;

/** List the interactive UI elements (name, type, bounds) of the active window. */
export class UiListTool extends Tool {
	name = 'ui_list';
	description =
		'List clickable/editable UI elements of the focused window (name, type, position). Use before ui_click.';
	permissionLevel = 'low' as const;
	parameters: readonly { name: string; type: 'string'; description: string }[] = [];

	async execute(): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('ui_list requires Windows.');
		try {
			const out = await runPs(LIST_SCRIPT, 30_000);
			const raw = out.trim() || '[]';
			let parsed: unknown[];
			try {
				const json = JSON.parse(raw);
				parsed = Array.isArray(json) ? json : [json];
			} catch {
				parsed = [];
			}
			const elements = (parsed as Array<Record<string, unknown>>)
				.filter((e) => e && typeof e.name === 'string' && e.name)
				.map((e) => ({
					name: e.name,
					type: e.type ?? '',
					id: e.id ?? '',
					x: Number(e.x ?? 0),
					y: Number(e.y ?? 0),
					w: Number(e.w ?? 0),
					h: Number(e.h ?? 0)
				}));
			return elements.length
				? ok(`${elements.length} UI element(s) found.`, { elements })
				: ok('No UI elements found in the active window.', { elements: [] });
		} catch (err) {
			return fail('Failed to read the UI tree.', (err as Error).message);
		}
	}
}

/** Click a UI element by its on-screen text/name instead of raw coordinates. */
export class UiClickTool extends Tool {
	name = 'ui_click';
	description = 'Click a button/control in the focused window by its visible text label.';
	permissionLevel = 'high' as const;
	parameters = [
		{
			name: 'name',
			type: 'string',
			description: 'Visible text label of the control, e.g. "Save", "OK", "Send".'
		}
	] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('ui_click requires Windows.');
		const name = requireString(args, 'name', 200);
		const granted = await context.requestPermission({
			permission_level: this.permissionLevel,
			tool: this.name,
			arguments: { name }
		});
		if (!granted) return fail('UI click was denied by the user.');
		const script = FIND_TEMPLATE.replace('__TARGET__', name.replace(/'/g, "''"))
			.concat(`\nif (-not $script:hit) { 'NOT_FOUND'; exit }
[void][UiClick]::SetCursorPos($script:cx, $script:cy)
[UiClick]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
[UiClick]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
"CLICKED $script:cx,$script:cy"`);
		try {
			const out = await runPs(script, 30_000);
			if (out.startsWith('NOT_FOUND'))
				return fail(`No control labeled "${name}" found.`, 'not found');
			return ok(out || `Clicked "${name}".`);
		} catch (err) {
			return fail(`Failed to click "${name}".`, (err as Error).message);
		}
	}
}

/** Set the value of a text field by its label/name using the UIA Value pattern. */
export class UiSetTextTool extends Tool {
	name = 'ui_set_text';
	description = 'Fill a text field in the focused window by its label/name.';
	permissionLevel = 'high' as const;
	parameters = [
		{
			name: 'name',
			type: 'string',
			description: 'Label of the text field, e.g. "Search", "To", "Name".'
		},
		{ name: 'text', type: 'string', description: 'Text to insert.' }
	] as const;

	async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
		if (process.platform !== 'win32') return fail('ui_set_text requires Windows.');
		const name = requireString(args, 'name', 200);
		const text = requireString(args, 'text', 4000);
		const granted = await context.requestPermission({
			permission_level: this.permissionLevel,
			tool: this.name,
			arguments: { name, length: text.length }
		});
		if (!granted) return fail('Text fill was denied by the user.');
		const script = FIND_TEMPLATE.replace('__TARGET__', name.replace(/'/g, "''"))
			.concat(`\nif (-not $script:hit) { 'NOT_FOUND'; exit }
$vp = $null
if ($script:hit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
  $vp.SetValue('${text.replace(/'/g, "''")}')
  "SET OK"
} else {
  'NO_VALUE_PATTERN'
}`);
		try {
			const out = await runPs(script, 30_000);
			if (out.startsWith('NOT_FOUND'))
				return fail(`No field labeled "${name}" found.`, 'not found');
			if (out.startsWith('NO_VALUE_PATTERN'))
				return fail(`Field "${name}" does not support direct text entry.`, 'value pattern missing');
			return ok(`Set "${name}" to "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}".`);
		} catch (err) {
			return fail(`Failed to fill "${name}".`, (err as Error).message);
		}
	}
}
