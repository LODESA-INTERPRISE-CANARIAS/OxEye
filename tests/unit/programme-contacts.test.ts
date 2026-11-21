import {describe, expect, it} from 'vitest';
import {CARTO_DATA, MAPS_DATA} from '../../src/data/geodata';
import {createDefaultProject, parseImportedProject} from '../../src/db/repository';
import {
  configure,
  initialScene,
  validateScene,
} from '../../src/engine/crowd/presets';
import {smallExample} from '../../src/engine/crowd/small-example';
import {
  buildContactInquiryMessage,
  buildMailtoHref,
  buildWhatsAppHref,
  getContactKinds,
  migrateSceneContactsAndProgramme,
  removeContactFromScene,
  validateCustomOption,
} from '../../src/engine/planning/contacts';
import {
  activities,
  type ActivitySpec,
  planProgramme,
} from '../../src/engine/planning/programme';
import type {ContactItem, Scene} from '../../src/types';

describe('Programme with Custom Activities & Contact Associations', () => {
  it('schedules custom activities, preserves user contactId, and never auto-assigns companies', () => {
    configure(MAPS_DATA);
    const scene = smallExample(initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA));
    scene.eventDays = 2;

    const customAct: ActivitySpec = {
      id: 'custom-ceramica',
      name: 'Taller de cerámica local',
      category: 'Artesanía',
      minutes: 60,
      cost: 80,
      places: 18,
      need: 'open',
      area: 15,
      enabled: true,
      contactId: 'contact-sol',
      custom: true,
    };
    const baseWithoutContact: ActivitySpec = {
      ...activities[0],
      cost: 120,
      enabled: true,
    };

    const result = planProgramme(scene, {
      budget: 1500,
      reserve: 10,
      sessions: 2,
      start: 10,
      finish: 14,
      area: 60,
      items: [customAct, baseWithoutContact],
    });

    expect(result.schedule.length).toBeGreaterThanOrEqual(2);
    const scheduledCustom = result.schedule.find(
      (s) => s.id === 'custom-ceramica'
    );
    expect(scheduledCustom).toBeDefined();
    expect(scheduledCustom?.contactId).toBe('contact-sol');

    const scheduledBase = result.schedule.find(
      (s) => s.id === baseWithoutContact.id
    );
    expect(scheduledBase).toBeDefined();
    expect(scheduledBase?.contactId).toBeUndefined();
  });

  it('migrates legacy projects without contact IDs and unlinks deleted contacts cleanly', () => {
    const project = createDefaultProject();
    // Simulate legacy JSON where contacts had no `id` and no new optional fields
    const legacyContact = {
      name: 'Sonido Norte',
      kind: 'Montaje',
      email: 'hola@sonidonorte.es',
      phone: '34600111222',
    } as unknown as ContactItem;
    project.scenes.cristo.contacts = [legacyContact];

    const imported = parseImportedProject(
      JSON.stringify(project),
      project,
      MAPS_DATA
    );
    const migratedContacts = imported.scenes.cristo.contacts || [];
    expect(migratedContacts.length).toBe(1);
    expect(typeof migratedContacts[0].id).toBe('string');
    expect(migratedContacts[0].id.length).toBeGreaterThan(5);

    const cid = migratedContacts[0].id;
    const sc = imported.scenes.cristo;
    sc.activityContacts = {'custom-1': cid};
    sc.programme = {
      schedule: [
        {
          id: 'custom-1',
          name: 'Concierto acústico',
          day: 0,
          start: 600,
          end: 660,
          cost: 200,
          contactId: cid,
        },
      ],
      pending: [],
      spent: 200,
      reserved: 0,
      unspent: 800,
    };

    removeContactFromScene(sc, cid);
    expect(sc.contacts?.length).toBe(0);
    expect(sc.activityContacts?.['custom-1']).toBeUndefined();
    const prog = sc.programme as {schedule: Array<{contactId?: string}>};
    expect(prog.schedule.length).toBe(1);
    expect(prog.schedule[0].contactId).toBeUndefined();
  });

  it('validates custom contact kinds without empty or case-insensitive duplicates', () => {
    const existing = getContactKinds({
      contacts: [{id: 'c1', name: 'Luz', kind: 'Iluminación'}],
      contactKinds: ['Sonido'],
    } as Pick<Scene, 'contacts' | 'contactKinds'>);

    expect(existing).toContain('Foodtruck');
    expect(existing).toContain('Sonido');
    expect(existing).toContain('Iluminación');

    expect(validateCustomOption('   ', existing).ok).toBe(false);
    expect(validateCustomOption('foodtruck', existing).ok).toBe(false);
    expect(validateCustomOption('SONIDO', existing).ok).toBe(false);
    const valid = validateCustomOption('  Animación infantil  ', existing);
    expect(valid).toEqual({ok: true, value: 'Animación infantil'});
  });

  it('builds shared mailto and WhatsApp inquiry links and validates scene optional fields', () => {
    const msg = buildContactInquiryMessage(
      {name: 'Taller Sol', kind: 'Taller'},
      'Feria de Navidad',
      'Plaza del Cristo',
      ['Cerámica local']
    );
    expect(msg).toContain('Feria de Navidad');
    expect(msg).toContain('Cerámica local');
    expect(buildMailtoHref('info@sol.es', msg)).toContain('mailto:info%40sol.es');
    expect(buildWhatsAppHref('+34 600 123 456', msg)).toContain(
      'https://wa.me/34600123456'
    );

    configure(MAPS_DATA);
    const sc = initialScene('cristo', MAPS_DATA.cristo, CARTO_DATA);
    sc.customActivities = [
      {
        id: 'custom-a1',
        name: 'Taller de barro',
        category: 'Artesanía',
        minutes: 60,
        cost: 150,
        places: 15,
        area: 12,
        need: 'open',
      },
    ];
    sc.contacts = [{id: 'c-1', name: 'Taller Sol', kind: 'Taller'}];
    sc.activityContacts = {'custom-a1': 'c-1'};
    sc.contactKinds = ['Animación'];
    expect(() => validateScene(sc)).not.toThrow();

    migrateSceneContactsAndProgramme(sc);
    expect(sc.activityContacts['custom-a1']).toBe('c-1');
  });
});
