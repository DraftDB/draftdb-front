import { describe, expect, it } from 'vitest';
import {
    getDefaultTableName,
    getUniqueTableName,
    validateTableName,
} from '../table-name';

const t = (name: string, schema?: string | null, isView = false) => ({
    name,
    schema,
    isView,
});

describe('getDefaultTableName', () => {
    it('renvoie table_1 / view_1 sans table', () => {
        expect(getDefaultTableName([], false)).toBe('table_1');
        expect(getDefaultTableName([], true)).toBe('view_1');
    });

    it('part du nombre de tables du même type + 1', () => {
        const tables = [t('a'), t('b'), t('v', null, true)];
        expect(getDefaultTableName(tables, false)).toBe('table_3');
        expect(getDefaultTableName(tables, true)).toBe('view_2');
    });

    it('saute les noms déjà pris', () => {
        const tables = [t('table_1'), t('table_2'), t('x')];
        expect(getDefaultTableName(tables, false)).toBe('table_4');
        expect(getDefaultTableName([t('table_2')], false)).toBe('table_3');
    });

    it('ignore la casse', () => {
        expect(getDefaultTableName([t('TABLE_2')], false)).toBe('table_3');
    });

    it('ignore le schéma (prudent)', () => {
        expect(getDefaultTableName([t('table_2', 'other')], false)).toBe(
            'table_3'
        );
    });
});

describe('getUniqueTableName', () => {
    it('garde le nom s’il est libre', () => {
        expect(
            getUniqueTableName({
                baseName: 'x_copy',
                tables: [t('x')],
                schema: null,
            })
        ).toBe('x_copy');
    });

    it('ajoute _2, _3… si le nom est pris dans le schéma', () => {
        const tables = [t('x_copy'), t('x_copy_2')];
        expect(
            getUniqueTableName({
                baseName: 'x_copy',
                tables: [t('x_copy')],
                schema: null,
            })
        ).toBe('x_copy_2');
        expect(
            getUniqueTableName({
                baseName: 'x_copy',
                tables: tables,
                schema: null,
            })
        ).toBe('x_copy_3');
    });

    it('un nom pris dans un autre schéma est libre', () => {
        expect(
            getUniqueTableName({
                baseName: 'x',
                tables: [t('x', 'a')],
                schema: 'b',
            })
        ).toBe('x');
    });

    it('compare la casse exacte', () => {
        expect(
            getUniqueTableName({
                baseName: 'X',
                tables: [t('x')],
                schema: null,
            })
        ).toBe('X');
    });

    it('traite null, absent et vide comme le même schéma', () => {
        expect(
            getUniqueTableName({
                baseName: 'x',
                tables: [t('x', '')],
                schema: null,
            })
        ).toBe('x_2');
        expect(
            getUniqueTableName({ baseName: 'x', tables: [t('x')], schema: '' })
        ).toBe('x_2');
    });

    it('reste à 63 caractères au plus', () => {
        const long = 'a'.repeat(63);
        const result = getUniqueTableName({
            baseName: long,
            tables: [t(long)],
            schema: null,
        });
        expect(result).toHaveLength(63);
        expect(result.endsWith('_2')).toBe(true);
        expect(
            getUniqueTableName({
                baseName: 'b'.repeat(80),
                tables: [],
                schema: null,
            })
        ).toHaveLength(63);
    });
});

describe('validateTableName', () => {
    it('accepte un nom libre', () => {
        expect(validateTableName('users', [t('orders')], null)).toBeNull();
    });

    it('refuse un nom vide ou fait d’espaces', () => {
        expect(validateTableName('', [], null)).toBe('empty');
        expect(validateTableName('   ', [], null)).toBe('empty');
    });

    it('refuse plus de 63 caractères, après retrait des espaces', () => {
        expect(validateTableName('a'.repeat(63), [], null)).toBeNull();
        expect(validateTableName('a'.repeat(64), [], null)).toBe('too_long');
        expect(validateTableName(` ${'a'.repeat(63)} `, [], null)).toBeNull();
    });

    it('refuse un nom déjà pris dans le même schéma', () => {
        expect(
            validateTableName('users', [t('users', 'public')], 'public')
        ).toBe('taken');
    });

    it('retire les espaces autour avant de comparer', () => {
        expect(validateTableName('  users ', [t('users')], null)).toBe('taken');
    });

    it('compare la casse exacte, comme le back', () => {
        expect(validateTableName('Users', [t('users')], null)).toBeNull();
        expect(validateTableName('users', [t('Users')], null)).toBeNull();
    });

    it('accepte le même nom dans un autre schéma', () => {
        expect(
            validateTableName('users', [t('users', 'public')], 'sales')
        ).toBeNull();
        expect(
            validateTableName('users', [t('users', 'public')], null)
        ).toBeNull();
    });

    it('traite null, absent et chaîne vide comme le même schéma', () => {
        expect(validateTableName('users', [t('users', '')], null)).toBe(
            'taken'
        );
        expect(validateTableName('users', [t('users', null)], '')).toBe(
            'taken'
        );
        expect(validateTableName('users', [t('users')], undefined)).toBe(
            'taken'
        );
    });
});
