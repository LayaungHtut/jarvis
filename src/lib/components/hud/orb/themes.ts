import * as THREE from 'three';
import type { AgentStatus } from '$lib/shared/types';

export interface OrbTheme {
	core: THREE.Color;
	ring: THREE.Color;
	accent: THREE.Color;
	text: string;
	label: string;
	/** Overall animation energy multiplier (speed / intensity). */
	energy: number;
	/** Breathing amplitude of the core. */
	breath: number;
}

export const ORB_THEMES: Record<AgentStatus, OrbTheme> = {
	idle: {
		core: new THREE.Color('#22d3ee'),
		ring: new THREE.Color('#0e7490'),
		accent: new THREE.Color('#67e8f9'),
		text: 'text-cyan-300',
		label: 'IDLE',
		energy: 0.4,
		breath: 0.06
	},
	processing: {
		core: new THREE.Color('#a78bfa'),
		ring: new THREE.Color('#6d28d9'),
		accent: new THREE.Color('#ddd6fe'),
		text: 'text-violet-300',
		label: 'PROCESSING',
		energy: 2.6,
		breath: 0.24
	},
	thinking: {
		core: new THREE.Color('#38bdf8'),
		ring: new THREE.Color('#0369a1'),
		accent: new THREE.Color('#bae6fd'),
		text: 'text-sky-300',
		label: 'THINKING',
		energy: 1.8,
		breath: 0.16
	},
	executing: {
		core: new THREE.Color('#60a5fa'),
		ring: new THREE.Color('#1d4ed8'),
		accent: new THREE.Color('#bfdbfe'),
		text: 'text-blue-300',
		label: 'EXECUTING',
		energy: 2.2,
		breath: 0.2
	},
	observing: {
		core: new THREE.Color('#2dd4bf'),
		ring: new THREE.Color('#0f766e'),
		accent: new THREE.Color('#99f6e4'),
		text: 'text-teal-300',
		label: 'OBSERVING',
		energy: 1.4,
		breath: 0.14
	},
	error: {
		core: new THREE.Color('#f87171'),
		ring: new THREE.Color('#b91c1c'),
		accent: new THREE.Color('#fecaca'),
		text: 'text-red-400',
		label: 'ERROR',
		energy: 3.2,
		breath: 0.3
	}
};
