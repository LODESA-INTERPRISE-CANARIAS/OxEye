import {integer, real, sqliteTable, text} from 'drizzle-orm/sqlite-core';

/**
 * Drizzle ORM SQLite table schema for OxEye projects.
 * Designed for seamless migration between web (IndexedDB/SQL.js) and desktop (SQLite).
 */
export const projectsTable = sqliteTable('projects', {
  id: text('id').primaryKey(),
  version: integer('version').notNull().default(1),
  format: text('format').notNull().default('ojo-de-buey'),
  activeVenue: text('active_venue').notNull().default('cristo'),
  mapsJson: text('maps_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * Drizzle ORM SQLite table schema for venue scenes (`cristo`, `constitucion`, `vega`).
 */
export const scenesTable = sqliteTable('scenes', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projectsTable.id, {onDelete: 'cascade'}),
  venueKey: text('venue_key').notNull(),
  title: text('title').notNull(),
  eventDate: text('event_date'),
  eventDays: integer('event_days').default(1),
  seed: integer('seed').notNull().default(2026),
  diameter: real('diameter').notNull().default(0.6),
  maxWait: real('max_wait').notNull().default(12),
  sceneJson: text('scene_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * Drizzle ORM SQLite table schema for georeferenced review annotations.
 */
export const annotationsTable = sqliteTable('annotations', {
  id: text('id').primaryKey(),
  sceneId: text('scene_id')
    .notNull()
    .references(() => scenesTable.id, {onDelete: 'cascade'}),
  venueKey: text('venue_key').notNull(),
  cell: text('cell').notNull(),
  gridMeters: integer('grid_meters').notNull().default(10),
  xPercent: real('x_percent').notNull(),
  yPercent: real('y_percent').notNull(),
  textContent: text('text_content').notNull(),
});

/**
 * Drizzle ORM SQLite table schema for provider contacts.
 */
export const contactsTable = sqliteTable('contacts', {
  id: text('id').primaryKey(),
  sceneId: text('scene_id')
    .notNull()
    .references(() => scenesTable.id, {onDelete: 'cascade'}),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  email: text('email'),
  phone: text('phone'),
});

/**
 * Drizzle ORM SQLite table schema for subcontractor companies (`pre` / `post` shifts).
 */
export const companiesTable = sqliteTable('companies', {
  id: text('id').primaryKey(),
  sceneId: text('scene_id')
    .notNull()
    .references(() => scenesTable.id, {onDelete: 'cascade'}),
  name: text('name').notNull(),
  lead: text('lead').notNull(),
  scope: text('scope').notNull(),
  prePeople: integer('pre_people').notNull().default(3),
  preTrucks: integer('pre_trucks').notNull().default(1),
  preForks: integer('pre_forks').notNull().default(1),
  postPeople: integer('post_people').notNull().default(3),
  postTrucks: integer('post_trucks').notNull().default(1),
  postForks: integer('post_forks').notNull().default(1),
});

/**
 * Drizzle ORM SQLite table schema for simulation audit runs and batch evaluations.
 */
export const simulationRunsTable = sqliteTable('simulation_runs', {
  id: text('id').primaryKey(),
  sceneId: text('scene_id')
    .notNull()
    .references(() => scenesTable.id, {onDelete: 'cascade'}),
  seed: integer('seed').notNull(),
  simulatedSeconds: real('simulated_seconds').notNull(),
  score: real('score').notNull(),
  reportJson: text('report_json').notNull(),
  createdAt: text('created_at').notNull(),
});
