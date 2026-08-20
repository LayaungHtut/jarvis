<script lang="ts">
	import * as THREE from 'three';
	import { T, useTask } from '@threlte/core';
	import type { AgentStatus } from '$lib/shared/types';
	import { ORB_THEMES } from './themes';

	let { status }: { status: AgentStatus } = $props();

	// three.js object refs (raw so Svelte never deep-proxies THREE objects)
	let camera: THREE.PerspectiveCamera | undefined = $state.raw();
	let world: THREE.Group | undefined = $state.raw();
	let core: THREE.Mesh | undefined = $state.raw();
	let coreMat: THREE.MeshBasicMaterial | undefined = $state.raw();
	let hex: THREE.Mesh | undefined = $state.raw();
	let hexMat: THREE.MeshBasicMaterial | undefined = $state.raw();
	let glowSprite: THREE.Sprite | undefined = $state.raw();
	let glowMat: THREE.SpriteMaterial | undefined = $state.raw();
	let ringA: THREE.Mesh | undefined = $state.raw();
	let ringAMat: THREE.MeshBasicMaterial | undefined = $state.raw();
	let ringB: THREE.Mesh | undefined = $state.raw();
	let ringBMat: THREE.MeshBasicMaterial | undefined = $state.raw();
	let ringC: THREE.Mesh | undefined = $state.raw();
	let ringCMat: THREE.MeshBasicMaterial | undefined = $state.raw();
	let scan: THREE.Mesh | undefined = $state.raw();
	let scanMat: THREE.MeshBasicMaterial | undefined = $state.raw();
	let burst: THREE.Mesh | undefined = $state.raw();
	let burstMat: THREE.MeshBasicMaterial | undefined = $state.raw();
	let particles: THREE.Points | undefined = $state.raw();
	let particleMat: THREE.PointsMaterial | undefined = $state.raw();
	let hexGroup: THREE.Group | undefined = $state.raw();

	let glowTex: THREE.Texture | null = $state.raw(
		typeof document !== 'undefined' ? makeGlowTexture() : null
	);
	let scanTex: THREE.Texture | null = $state.raw(
		typeof document !== 'undefined' ? makeScanTexture() : null
	);

	// ----- particle cloud (pure math, safe to build immediately) -----
	const PARTICLE_COUNT = 420;

	function buildParticleSetup() {
		const positions = new Float32Array(PARTICLE_COUNT * 3);
		const base = new Float32Array(PARTICLE_COUNT * 3);
		const phases = new Float32Array(PARTICLE_COUNT);
		for (let i = 0; i < PARTICLE_COUNT; i++) {
			const theta = Math.random() * Math.PI * 2;
			const phi = Math.acos(2 * Math.random() - 1);
			const r = 1.9 + Math.random() * 0.65;
			base[i * 3] = r * Math.sin(phi) * Math.cos(theta);
			base[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
			base[i * 3 + 2] = r * Math.cos(phi);
			positions[i * 3] = base[i * 3];
			positions[i * 3 + 1] = base[i * 3 + 1];
			positions[i * 3 + 2] = base[i * 3 + 2];
			phases[i] = Math.random() * Math.PI * 2;
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geo.computeBoundingSphere();
		return { geo, positions, base, phases };
	}

	const particleSetup = buildParticleSetup();
	let particleGeometry: THREE.BufferGeometry = $state.raw(particleSetup.geo);
	const particlePositions = particleSetup.positions;
	const particleBase = particleSetup.base;
	const particlePhases = particleSetup.phases;

	// ----- floating hex satellites (added to hexGroup once it exists) -----
	let hexes: {
		mesh: THREE.Mesh;
		mat: THREE.MeshBasicMaterial;
		angle: number;
		radius: number;
		speed: number;
		phase: number;
		yOff: number;
	}[] = [];

	$effect(() => {
		if (typeof document === 'undefined' || !hexGroup || hexes.length) return;
		for (let i = 0; i < 4; i++) {
			const geo = new THREE.CylinderGeometry(0.05, 0.05, 0.014, 6);
			const mat = new THREE.MeshBasicMaterial({
				color: ORB_THEMES.idle.accent,
				transparent: true,
				opacity: 0.7,
				depthWrite: false,
				blending: THREE.AdditiveBlending
			});
			const mesh = new THREE.Mesh(geo, mat);
			hexGroup.add(mesh);
			hexes.push({
				mesh,
				mat,
				angle: (i / 4) * Math.PI * 2,
				radius: 2.15,
				speed: 0.35 + i * 0.12,
				phase: (i * 1.7) % (Math.PI * 2),
				yOff: i % 2 === 0 ? 0.22 : -0.22
			});
		}
	});

	// ----- pointer parallax -----
	const pointer = { x: 0, y: 0 };

	$effect(() => {
		const onMove = (e: PointerEvent) => {
			pointer.x = (e.clientX / window.innerWidth - 0.5) * 2;
			pointer.y = (e.clientY / window.innerHeight - 0.5) * 2;
		};
		window.addEventListener('pointermove', onMove);
		return () => window.removeEventListener('pointermove', onMove);
	});

	// ----- status transition shockwave -----
	let lastStatus: AgentStatus | null = null;
	let burstProgress = -1;

	$effect(() => {
		const s = status;
		if (lastStatus !== null && lastStatus !== s) burstProgress = 0;
		lastStatus = s;
	});

	// ----- animated colors (lerped each frame toward the active theme) -----
	const coreColor = new THREE.Color(ORB_THEMES.idle.core);
	const ringColor = new THREE.Color(ORB_THEMES.idle.ring);
	const accentColor = new THREE.Color(ORB_THEMES.idle.accent);

	let elapsed = 0;

	useTask((delta) => {
		elapsed += delta;
		const t = elapsed;
		const theme = ORB_THEMES[status];
		const e = theme.energy;
		const k = Math.min(1, delta * 4);

		coreColor.lerp(theme.core, k);
		ringColor.lerp(theme.ring, k);
		accentColor.lerp(theme.accent, k);

		// camera float + parallax
		if (camera) {
			camera.position.x = pointer.x * 0.18;
			camera.position.y = pointer.y * 0.14 + Math.sin(t * 0.3) * 0.06;
			camera.position.z = 5 + Math.sin(t * 0.4) * 0.08;
			camera.lookAt(0, 0, 0);
		}

		// world sway
		if (world) {
			world.rotation.y = t * 0.08;
			world.rotation.x = Math.sin(t * 0.15) * 0.06 + pointer.y * -0.05;
			world.rotation.z = pointer.x * -0.04;
		}

		// core breathing
		const breath = Math.sin(t * (0.9 + e * 0.9)) * theme.breath;
		if (core) core.scale.setScalar(1 + breath);
		if (coreMat) coreMat.color.copy(coreColor);

		// hex wireframe shell
		if (hex) {
			hex.rotation.y = t * (0.2 + 0.35 * e);
			hex.rotation.x = t * 0.12 * e;
		}
		if (hexMat) {
			hexMat.color.copy(coreColor);
			hexMat.opacity = 0.35 + 0.2 * Math.sin(t * (1 + 2 * e));
		}

		// glow sprite
		if (glowSprite) glowSprite.scale.setScalar(3.1 + Math.sin(t * (1 + e)) * 0.25);
		if (glowMat) {
			glowMat.color.copy(accentColor);
			glowMat.opacity = 0.55 + 0.15 * Math.sin(t * (1.4 + e * 0.6));
		}

		// HUD rings
		if (ringA) ringA.rotation.z += delta * (0.6 * e + 0.15);
		if (ringB) ringB.rotation.y += delta * (0.5 * e + 0.12);
		if (ringC) ringC.rotation.z += delta * (0.45 * e + 0.1);
		const ringOp = 0.35 + 0.18 * Math.sin(t * (1.2 * e + 2));
		if (ringAMat) {
			ringAMat.color.copy(ringColor);
			ringAMat.opacity = ringOp;
		}
		if (ringBMat) {
			ringBMat.color.copy(ringColor);
			ringBMat.opacity = ringOp * 0.8;
		}
		if (ringCMat) {
			ringCMat.color.copy(ringColor);
			ringCMat.opacity = ringOp * 0.6;
		}

		// radar scan disc
		if (scan) scan.rotation.x = Math.PI / 2 + t * (0.8 + e * 1.4);
		if (scanMat) {
			scanMat.color.copy(accentColor);
			scanMat.opacity = 0.5 + 0.3 * Math.sin(t * (2 + e));
		}

		// status-change shockwave
		if (burst) burst.visible = burstProgress >= 0;
		if (burstProgress >= 0) {
			burstProgress = Math.min(1, burstProgress + delta * 2);
			const p = 1 - Math.pow(1 - burstProgress, 3);
			if (burst) burst.scale.setScalar(0.9 + p * 2.4);
			if (burstMat) burstMat.opacity = (1 - p) * 0.85;
			if (burstProgress >= 1) burstProgress = -1;
		}

		// hex satellites
		const bob = Math.sin(t * 0.8) * 0.1;
		for (const h of hexes) {
			h.angle += delta * h.speed * e;
			h.mesh.position.set(
				Math.cos(h.angle) * h.radius,
				Math.sin(h.angle + h.phase) * h.radius * 0.35 + bob + h.yOff,
				Math.sin(h.angle) * h.radius
			);
			h.mesh.rotation.z += delta * 2;
			h.mesh.rotation.y = t * 0.4 * e;
			h.mat.color.copy(accentColor);
			h.mat.opacity = 0.5 + 0.25 * Math.sin(t * (1 + 2 * e) + h.phase);
		}

		// particle cloud
		if (particles) {
			particles.rotation.y = t * 0.1 * e;
			particles.rotation.x = Math.sin(t * 0.1) * 0.08;
		}
		if (particleMat) {
			particleMat.color.copy(ringColor);
			particleMat.opacity = 0.55 + 0.3 * Math.sin(t * (1 + e));
		}
		const amp = 0.1 + e * 0.03;
		for (let i = 0; i < PARTICLE_COUNT; i++) {
			const pulse = 1 + Math.sin(t * (1.6 + e * 1.2) + particlePhases[i]) * amp;
			const o = i * 3;
			particlePositions[o] = particleBase[o] * pulse;
			particlePositions[o + 1] = particleBase[o + 1] * pulse;
			particlePositions[o + 2] = particleBase[o + 2] * pulse;
		}
		particleGeometry.attributes.position.needsUpdate = true;
	});

	// ----- helpers -----
	function makeGlowTexture(): THREE.Texture {
		const size = 256;
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d')!;
		const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
		g.addColorStop(0, 'rgba(255,255,255,1)');
		g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
		g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
		g.addColorStop(1, 'rgba(255,255,255,0)');
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, size, size);
		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		return tex;
	}

	function makeScanTexture(): THREE.Texture {
		const size = 256;
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d')!;
		const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
		g.addColorStop(0, 'rgba(255,255,255,0)');
		g.addColorStop(0.55, 'rgba(255,255,255,0)');
		g.addColorStop(0.7, 'rgba(255,255,255,0.25)');
		g.addColorStop(0.82, 'rgba(255,255,255,0.6)');
		g.addColorStop(0.93, 'rgba(255,255,255,0.25)');
		g.addColorStop(1, 'rgba(255,255,255,0)');
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, size, size);
		const tex = new THREE.CanvasTexture(canvas);
		tex.colorSpace = THREE.SRGBColorSpace;
		return tex;
	}
</script>

<T.PerspectiveCamera makeDefault bind:ref={camera} position={[0, 0, 5]} fov={45} />

<T.Group bind:ref={world} scale={0.95}>
	<!-- additive glow halo -->
	<T.Sprite bind:ref={glowSprite} scale={3.2}>
		<T.SpriteMaterial
			bind:ref={glowMat}
			map={glowTex}
			transparent
			depthWrite={false}
			blending={THREE.AdditiveBlending}
		/>
	</T.Sprite>

	<!-- core -->
	<T.Mesh bind:ref={core}>
		<T.SphereGeometry args={[0.8, 48, 48]} />
		<T.MeshBasicMaterial
			bind:ref={coreMat}
			color={ORB_THEMES.idle.core}
			transparent
			opacity={0.92}
			depthWrite={false}
		/>
	</T.Mesh>

	<!-- inner hex wireframe shell -->
	<T.Mesh bind:ref={hex}>
		<T.IcosahedronGeometry args={[1.05, 0]} />
		<T.MeshBasicMaterial
			bind:ref={hexMat}
			wireframe
			transparent
			opacity={0.45}
			depthWrite={false}
			blending={THREE.AdditiveBlending}
		/>
	</T.Mesh>

	<!-- HUD rings -->
	<T.Mesh bind:ref={ringA} rotation={[Math.PI / 2, 0, 0]}>
		<T.TorusGeometry args={[1.5, 0.008, 6, 80]} />
		<T.MeshBasicMaterial
			bind:ref={ringAMat}
			transparent
			opacity={0.4}
			depthWrite={false}
			blending={THREE.AdditiveBlending}
		/>
	</T.Mesh>
	<T.Mesh bind:ref={ringB} rotation={[Math.PI / 3, Math.PI / 6, 0]}>
		<T.TorusGeometry args={[1.66, 0.008, 6, 80]} />
		<T.MeshBasicMaterial
			bind:ref={ringBMat}
			transparent
			opacity={0.35}
			depthWrite={false}
			blending={THREE.AdditiveBlending}
		/>
	</T.Mesh>
	<T.Mesh bind:ref={ringC} rotation={[Math.PI / 3, -Math.PI / 5, Math.PI / 4]}>
		<T.TorusGeometry args={[1.84, 0.008, 6, 80]} />
		<T.MeshBasicMaterial
			bind:ref={ringCMat}
			transparent
			opacity={0.3}
			depthWrite={false}
			blending={THREE.AdditiveBlending}
		/>
	</T.Mesh>

	<!-- radar scan disc -->
	<T.Mesh bind:ref={scan} rotation={[Math.PI / 2, 0, 0]}>
		<T.CircleGeometry args={[1.9, 48]} />
		<T.MeshBasicMaterial
			bind:ref={scanMat}
			map={scanTex}
			transparent
			depthWrite={false}
			blending={THREE.AdditiveBlending}
			side={THREE.DoubleSide}
		/>
	</T.Mesh>

	<!-- status-change shockwave -->
	<T.Mesh bind:ref={burst} visible={false}>
		<T.RingGeometry args={[0.7, 0.85, 64]} />
		<T.MeshBasicMaterial
			bind:ref={burstMat}
			transparent
			depthWrite={false}
			blending={THREE.AdditiveBlending}
			side={THREE.DoubleSide}
		/>
	</T.Mesh>

	<!-- breathing particle cloud -->
	<T.Points bind:ref={particles}>
		<T.BufferGeometry is={particleGeometry} />
		<T.PointsMaterial
			bind:ref={particleMat}
			size={0.035}
			transparent
			opacity={0.7}
			depthWrite={false}
			blending={THREE.AdditiveBlending}
		/>
	</T.Points>

	<!-- orbiting hex satellites (added imperatively) -->
	<T.Group bind:ref={hexGroup} />
</T.Group>
