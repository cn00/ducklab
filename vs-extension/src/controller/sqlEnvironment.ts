const SQL_ENV_VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$(?!\{)([A-Za-z_][A-Za-z0-9_]*)/g;
const DOTENV_LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm;

export interface ExpandedSql {
    query: string;
    secrets: string[];
}

export function sqlEnvironmentVariableNames(sql: string): string[] {
    const names = new Set<string>();
    for (const match of sql.matchAll(SQL_ENV_VARIABLE)) {
        names.add(match[1] ?? match[2]);
    }
    return [...names];
}

export function parseDotEnv(source: string): Record<string, string> {
    const values: Record<string, string> = Object.create(null);
    const content = source.replace(/^\uFEFF/, '');
    DOTENV_LINE.lastIndex = 0;
    for (const match of content.matchAll(DOTENV_LINE)) {
        const key = match[1];
        let value = (match[2] ?? '').trim();
        const quote = value[0];
        if ((quote === '"' || quote === "'" || quote === '`') && value.endsWith(quote)) {
            value = value.slice(1, -1);
            if (quote === '"') {
                value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
            }
        }
        values[key] = value;
    }
    return values;
}

export function expandSqlText(sql: string, environment: Record<string, string | undefined>): ExpandedSql {
    const missing = new Set<string>();
    const secrets = new Set<string>();
    const query = sql.replace(SQL_ENV_VARIABLE, (placeholder, bracedName: string | undefined, plainName: string | undefined) => {
        const name = bracedName ?? plainName;
        const value = environment[name];
        if (value === undefined) {
            missing.add(name);
            return placeholder;
        }
        if (value) secrets.add(value);
        return value;
    });

    if (missing.size) {
        throw new Error(`Undefined SQL environment variable(s): ${[...missing].join(', ')}`);
    }
    return { query, secrets: [...secrets] };
}

export function redactSecrets(message: string, secrets: string[]): string {
    return [...new Set(secrets.filter(Boolean))]
        .sort((left, right) => right.length - left.length)
        .reduce((redacted, secret) => redacted.split(secret).join('[REDACTED]'), message);
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
