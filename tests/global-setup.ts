import { execFileSync } from 'node:child_process';
import type { FullConfig } from '@playwright/test';

export default async function globalSetup(config: FullConfig) {
	const baseURL = new URL(config.projects[0].use.baseURL!);
	if (!process.env.CI) {
		try {
			const response = await fetch(baseURL, { signal: AbortSignal.timeout(2000) });
			if (response.ok) return;
		} catch {
			// No existing local server; start one for this test run.
		}
	}

	// Background mode exits once Astro is ready. Start it outside Playwright's
	// webServer supervisor, which expects its command to remain running.
	execFileSync('npm', [
		'run', 'dev', '--', '--background', '--host', baseURL.hostname, '--port', baseURL.port,
	], { stdio: 'inherit' });

	const stop = () => {
		execFileSync('npm', ['run', 'astro', '--', 'dev', 'stop'], { stdio: 'inherit' });
	};
	try {
		const response = await fetch(baseURL, { signal: AbortSignal.timeout(10000) });
		if (!response.ok) throw new Error(`Astro test server returned ${response.status}`);
	} catch (error) {
		stop();
		throw error;
	}

	// Stop only the server started here; leave reused local servers running.
	return stop;
}
