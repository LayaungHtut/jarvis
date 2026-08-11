import { Client, type ClientConfig } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadEnv } from '../config/env';

/**
 * Applies the SQL migrations in migrations/<provider>/account-<n>/ to each
 * configured cloud database. Tracks applied files in a schema_migrations table.
 *
 * Connection strings come from the environment:
 *   SUPABASE_DATABASE_URL_1 / _2   (Postgres URL of each Supabase project)
 *   NEON_DATABASE_URL_1 / _2       (Neon pooled/direct connection string)
 *
 * Run with: npm run migrate:memory
 */
interface AccountSpec {
	provider: 'supabase' | 'neon';
	account: number;
	url?: string;
}

function accountSpecs(env = process.env): AccountSpec[] {
	const spec: AccountSpec[] = [];
	for (let i = 1; i <= 2; i++) {
		const supabaseUrl = env[`SUPABASE_DATABASE_URL_${i}`] ?? env[`SUPABASE_DB_URL_${i}`];
		if (supabaseUrl) spec.push({ provider: 'supabase', account: i, url: supabaseUrl });
		const neonUrl = env[`NEON_DATABASE_URL_${i}`] ?? env[`NEON_DB_URL_${i}`];
		if (neonUrl) spec.push({ provider: 'neon', account: i, url: neonUrl });
	}
	return spec;
}

async function applyMigrations(spec: AccountSpec): Promise<number> {
	if (!spec.url) return 0;
	if (!spec.url.startsWith('postgres://') && !spec.url.startsWith('postgresql://'))
		throw new Error(`Invalid DATABASE_URL for ${spec.provider}-${spec.account}`);

	const clientConfig: ClientConfig = {
		connectionString: spec.url,
		ssl: { rejectUnauthorized: false }
	};
	const client = new Client(clientConfig);
	await client.connect();
	try {
		await client.query(`
			create table if not exists schema_migrations (
				filename text primary key,
				provider text not null,
				account int not null,
				applied_at timestamptz not null default now()
			)
		`);
		const folder = resolve('migrations', spec.provider, `account-${spec.account}`);
		const files = readdirSync(folder)
			.filter((f) => f.endsWith('.sql'))
			.sort();
		let applied = 0;
		for (const file of files) {
			const { rowCount } = await client.query(
				'select 1 from schema_migrations where filename = $1',
				[file]
			);
			if (rowCount) continue;
			const sql = readFileSync(join(folder, file), 'utf8');
			await client.query('begin');
			try {
				await client.query(sql);
				await client.query(
					'insert into schema_migrations (filename, provider, account) values ($1, $2, $3)',
					[file, spec.provider, spec.account]
				);
				await client.query('commit');
				console.log(`  applied ${spec.provider}-${spec.account}/${file}`);
				applied++;
			} catch (err) {
				await client.query('rollback');
				throw err;
			}
		}
		return applied;
	} finally {
		await client.end();
	}
}

async function main(): Promise<void> {
	loadEnv();
	const specs = accountSpecs();
	if (specs.length === 0) {
		console.log(
			'No cloud memory databases configured (set SUPABASE_DATABASE_URL_N / NEON_DATABASE_URL_N).'
		);
		return;
	}
	for (const spec of specs) {
		try {
			console.log(`Migrating ${spec.provider}-${spec.account}…`);
			const n = await applyMigrations(spec);
			console.log(`  ${n === 0 ? 'up to date' : `${n} migration(s) applied`}`);
		} catch (err) {
			console.error(`  FAILED ${spec.provider}-${spec.account}: ${(err as Error).message}`);
			process.exitCode = 1;
		}
	}
}

void main();
