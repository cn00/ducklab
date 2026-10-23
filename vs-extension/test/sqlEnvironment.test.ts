import { expandSqlText, parseDotEnv, redactSecrets } from '../src/controller/sqlEnvironment';

describe('SQL environment expansion', () => {
    test('parses dotenv comments, export, quotes, escaped newlines, and multiline values', () => {
        const environment = parseDotEnv([
            '\uFEFF# comment',
            'export PGHOST=localhost # inline comment',
            "PGDATABASE='warehouse #1'",
            'PGPASSWORD="line1\\nline2=with#symbols"',
            "MULTILINE='first line",
            "second line'"
        ].join('\n'));

        expect(environment).toEqual({
            PGHOST: 'localhost',
            PGDATABASE: 'warehouse #1',
            PGPASSWORD: 'line1\nline2=with#symbols',
            MULTILINE: 'first line\nsecond line'
        });
    });

    test('expands braced and unbraced names without evaluating shell expressions', () => {
        const result = expandSqlText(
            "ATTACH 'host=$PGHOST dbname=${PGDATABASE} password=${PASSWORD:-fallback}'",
            { PGHOST: 'localhost', PGDATABASE: 'warehouse' }
        );

        expect(result.query).toBe("ATTACH 'host=localhost dbname=warehouse password=${PASSWORD:-fallback}'");
        expect(result.secrets).toEqual(['localhost', 'warehouse']);
    });

    test('fails with variable names when values are undefined', () => {
        expect(() => expandSqlText('ATTACH $PGHOST user=${PGUSER}', {})).toThrow('PGHOST, PGUSER');
    });

    test('redacts substituted values from errors', () => {
        expect(redactSecrets('Connection failed for secret-password', ['secret', 'secret-password']))
            .toBe('Connection failed for [REDACTED]');
    });
});
