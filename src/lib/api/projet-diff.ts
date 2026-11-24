import type { Diagram } from '@/lib/domain/diagram';
import type { DBTable } from '@/lib/domain/db-table';
import type { DBField } from '@/lib/domain/db-field';
import type { DBIndex } from '@/lib/domain/db-index';
import type { DBRelationship } from '@/lib/domain/db-relationship';

/**
 * Comparaison d'une copie locale avec la version du serveur, limitée au
 * contenu du schéma : nom, type de base, tables, colonnes (dans l'ordre),
 * index et relations. Les champs techniques ou de présentation sont ignorés
 * (createdAt/updatedAt, positions, largeur, couleur, ordre d'affichage,
 * zones, notes).
 */

/** null, undefined et '' sont équivalents. */
const opt = <T>(value: T | null | undefined): T | null =>
    value === undefined || value === null || (value as unknown) === ''
        ? null
        : value;

const bool = (value: boolean | null | undefined): boolean => value === true;

const byId = <T extends { id: string }>(items: T[] | undefined): T[] =>
    [...(items ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const projectField = (field: DBField) => ({
    id: field.id,
    name: field.name,
    type: field.type?.id ?? null,
    primaryKey: bool(field.primaryKey),
    unique: bool(field.unique),
    nullable: bool(field.nullable),
    increment: bool(field.increment),
    isArray: bool(field.isArray),
    characterMaximumLength: opt(field.characterMaximumLength),
    precision: opt(field.precision),
    scale: opt(field.scale),
    default: opt(field.default),
    collation: opt(field.collation),
    comments: opt(field.comments),
    check: opt(field.check),
});

const projectIndex = (index: DBIndex) => ({
    id: index.id,
    // Le nom auto-généré d'un index de clé primaire est vide en local et
    // renommé <table>_pkey par le back (cf. toTableBody) : non comparé.
    name: index.isPrimaryKey ? null : opt(index.name),
    unique: bool(index.unique),
    isPrimaryKey: bool(index.isPrimaryKey),
    fieldIds: [...(index.fieldIds ?? [])],
    type: opt(index.type),
    comments: opt(index.comments),
});

const projectTable = (table: DBTable) => ({
    id: table.id,
    name: table.name,
    schema: opt(table.schema),
    isView: bool(table.isView),
    isMaterializedView: bool(table.isMaterializedView),
    comments: opt(table.comments),
    // Ordre des colonnes significatif : pas de tri.
    fields: (table.fields ?? []).map(projectField),
    indexes: byId(table.indexes).map(projectIndex),
});

const projectRelationship = (relationship: DBRelationship) => ({
    id: relationship.id,
    name: opt(relationship.name),
    sourceSchema: opt(relationship.sourceSchema),
    sourceTableId: relationship.sourceTableId,
    sourceFieldId: relationship.sourceFieldId,
    targetSchema: opt(relationship.targetSchema),
    targetTableId: relationship.targetTableId,
    targetFieldId: relationship.targetFieldId,
    sourceCardinality: relationship.sourceCardinality,
    targetCardinality: relationship.targetCardinality,
});

/** Forme canonique du contenu comparé d'un diagramme. */
export const projectDiagramContent = (diagram: Diagram) => ({
    name: diagram.name,
    databaseType: diagram.databaseType,
    tables: byId(diagram.tables).map(projectTable),
    relationships: byId(diagram.relationships).map(projectRelationship),
});

export const isSameDiagramContent = (a: Diagram, b: Diagram): boolean =>
    JSON.stringify(projectDiagramContent(a)) ===
    JSON.stringify(projectDiagramContent(b));
