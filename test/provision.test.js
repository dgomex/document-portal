const { load, FakeSpreadsheet } = require('./harness');

const lib = load();
const { Config } = lib;

const row = (headers, r) => headers.map((h) => (r[h] === undefined ? '' : r[h]));

function sheet({ clients = [], cases = [], root = 'ROOT' } = {}) {
  return new FakeSpreadsheet({
    Settings: [['key', 'value', 'description'], ['root_folder_id', root, '']],
    Clients: [Config.SCHEMA.Clients, ...clients.map((r) => row(Config.SCHEMA.Clients, r))],
    Cases: [Config.SCHEMA.Cases, ...cases.map((r) => row(Config.SCHEMA.Cases, r))],
  });
}

function fakeDrive({ failOn, folders = {} } = {}) {
  const created = [];
  const renamed = [];
  const gets = [];
  return {
    created,
    renamed,
    gets,
    folders,
    createFolder(token, name, parentId) {
      if (failOn && name.includes(failOn)) throw new Error('Drive 500: boom');
      const id = 'F' + (created.length + 1);
      created.push({ id, name, parentId, token });
      folders[id] = { name };
      return { id };
    },
    get(token, id) {
      gets.push(id);
      if (!folders[id]) throw lib.Errors.make('drive', 'Drive 404', { status: 404 });
      return { id, name: folders[id].name, trashed: !!folders[id].trashed };
    },
    rename(token, id, name) {
      if (!folders[id]) throw lib.Errors.make('drive', 'Drive 404', { status: 404 });
      renamed.push({ id, name });
      folders[id].name = name;
      return { id, name };
    },
  };
}

function fakeProps(initial = {}) {
  const map = { ...initial };
  return {
    map,
    getProperties: () => ({ ...map }),
    getProperty: (k) => (k in map ? map[k] : null),
    setProperty(k, v) { map[k] = String(v); },
    deleteProperty(k) { delete map[k]; },
  };
}

function ctx(ss) {
  const lock = { held: false, tryLock() { this.held = true; return true; }, releaseLock() { this.held = false; } };
  return { ss, lock, script: { getOAuthToken: () => 'TOKEN' }, props: fakeProps(), cache: {} };
}

const clientRows = (ss) => lib.Clients.list(ss);
const caseRows = (ss) => lib.Cases.list(ss);

test('provisions a pending client and its case, nesting the case folder', () => {
  const ss = sheet({
    clients: [{ client_id: 'CL-AAAAAA', name: 'Ana Ferreira', email: 'ana@x.pt', active: true, provision_status: 'PENDING' }],
    cases: [{ case_id: 'CS-111111', client_id: 'CL-AAAAAA', case_name: 'Divórcio', status: 'open', provision_status: 'PENDING' }],
  });
  const drive = fakeDrive();
  const c = ctx(ss);
  const report = lib.Provision.run(c, { drive });

  expect(report.clients).toEqual({ active: 1, error: 0 });
  expect(report.cases).toEqual({ active: 1, error: 0, waiting: 0 });
  expect(drive.created).toEqual([
    { id: 'F1', name: 'Ana Ferreira [CL-AAAAAA]', parentId: 'ROOT', token: 'TOKEN' },
    { id: 'F2', name: 'Divórcio [CS-111111]', parentId: 'F1', token: 'TOKEN' },
  ]);
  expect(clientRows(ss)[0]).toMatchObject({ provision_status: 'ACTIVE', folder_id: 'F1', provision_error: '', created_by: 'sheet' });
  expect(caseRows(ss)[0]).toMatchObject({ provision_status: 'ACTIVE', folder_id: 'F2' });
  expect(c.lock.held).toBe(false);
});

test('running again creates nothing new', () => {
  const ss = sheet({
    clients: [{ client_id: 'CL-AAAAAA', name: 'Ana', email: 'ana@x.pt', active: true, provision_status: 'PENDING' }],
  });
  const drive = fakeDrive();
  lib.Provision.run(ctx(ss), { drive });
  lib.Provision.run(ctx(ss), { drive });
  lib.Provision.run(ctx(ss), { drive, retryErrors: true });
  expect(drive.created).toHaveLength(1);
  expect(lib.Provision.hasWork(ss)).toBe(false);
});

test('rows typed by hand get IDs, active=TRUE and open status; FALSE from the seed or skill is kept', () => {
  const ss = sheet({
    clients: [
      { name: 'Bruno Mendes', email: 'bruno@x.pt' },
      // An untouched checkbox cell reads FALSE in Sheets: hand-typed rows look like this one.
      { name: 'Eva Lopes', email: 'eva@x.pt', active: false },
      { name: 'Diogo Santos', email: 'diogo@x.pt', active: false, created_by: 'seed' },
    ],
  });
  lib.Provision.run(ctx(ss), { drive: fakeDrive() });
  const [bruno, eva, diogo] = clientRows(ss);
  expect(lib.Ids.isValid(bruno.client_id, 'CL')).toBe(true);
  expect(bruno).toMatchObject({ active: true, provision_status: 'ACTIVE' });
  expect(eva).toMatchObject({ active: true, provision_status: 'ACTIVE', created_by: 'sheet' });
  expect(diogo).toMatchObject({ active: false, provision_status: 'ACTIVE' });

  ss.getSheetByName('Cases').appendRow(row(Config.SCHEMA.Cases, { client_id: bruno.client_id, case_name: 'Arrendamento' }));
  lib.Provision.run(ctx(ss), { drive: fakeDrive() });
  expect(caseRows(ss)[0]).toMatchObject({ status: 'open', provision_status: 'ACTIVE' });
  expect(lib.Ids.isValid(caseRows(ss)[0].case_id, 'CS')).toBe(true);
});

test('invalid rows are marked ERROR with the reasons, and get no folder', () => {
  const ss = sheet({
    clients: [
      { client_id: 'CL-AAAAAA', name: 'Ana', email: 'ana@x.pt', active: true },
      { client_id: 'CL-BBBBBB', name: 'Impostor', email: 'ANA@x.pt', active: true },
      { client_id: 'CL-CCCCCC', name: '', email: 'not-an-email', active: true },
    ],
    cases: [{ case_id: 'CS-222222', client_id: 'CL-ZZZZZZ', case_name: 'Órfão', status: 'open' }],
  });
  const drive = fakeDrive();
  const report = lib.Provision.run(ctx(ss), { drive });
  const [, impostor, empty] = clientRows(ss);
  expect(impostor).toMatchObject({ provision_status: 'ERROR', provision_error: 'email ana@x.pt already used by CL-AAAAAA', folder_id: '' });
  expect(empty.provision_error).toBe('invalid name; invalid email');
  expect(caseRows(ss)[0]).toMatchObject({ provision_status: 'ERROR', provision_error: 'unknown client_id' });
  expect(report.clients).toEqual({ active: 1, error: 2 });
  expect(drive.created).toHaveLength(1);
});

test('the cron leaves ERROR rows alone; the menu retries them after a fix', () => {
  const ss = sheet({ clients: [{ client_id: 'CL-AAAAAA', name: 'Ana', email: 'bad', active: true }] });
  lib.Provision.run(ctx(ss), { drive: fakeDrive() });
  expect(clientRows(ss)[0].provision_status).toBe('ERROR');

  lib.Table.open(ss, 'Clients').update(2, { email: 'ana@x.pt' });
  expect(lib.Provision.hasWork(ss)).toBe(false);
  expect(lib.Provision.hasWork(ss, true)).toBe(true);
  lib.Provision.run(ctx(ss), { drive: fakeDrive(), retryErrors: true });
  expect(clientRows(ss)[0]).toMatchObject({ provision_status: 'ACTIVE', provision_error: '' });
});

test('a Drive failure marks only that row as ERROR', () => {
  const ss = sheet({
    clients: [
      { client_id: 'CL-AAAAAA', name: 'Ana', email: 'ana@x.pt', active: true },
      { client_id: 'CL-BBBBBB', name: 'Bruno', email: 'bruno@x.pt', active: true },
    ],
    cases: [{ case_id: 'CS-111111', client_id: 'CL-AAAAAA', case_name: 'Divórcio', status: 'open' }],
  });
  lib.Provision.run(ctx(ss), { drive: fakeDrive({ failOn: 'Ana' }) });
  const [ana, bruno] = clientRows(ss);
  expect(ana).toMatchObject({ provision_status: 'ERROR', provision_error: 'folder: Drive 500: boom' });
  expect(bruno.provision_status).toBe('ACTIVE');
  expect(caseRows(ss)[0]).toMatchObject({ provision_status: 'ERROR', provision_error: 'client CL-AAAAAA has an error' });
});

test('duplicate IDs are both refused', () => {
  const ss = sheet({
    clients: [
      { client_id: 'CL-AAAAAA', name: 'Ana', email: 'ana@x.pt', active: true },
      { client_id: 'CL-AAAAAA', name: 'Outra', email: 'outra@x.pt', active: true },
    ],
  });
  lib.Provision.run(ctx(ss), { drive: fakeDrive() });
  expect(clientRows(ss).map((r) => r.provision_error)).toEqual(['duplicate client_id', 'duplicate client_id']);
});

test('without setup it refuses, and still releases the lock', () => {
  const c = ctx(sheet({ root: '' }));
  expect(() => lib.Provision.run(c, { drive: fakeDrive() })).toThrow('Run Portal > Set up first');
  expect(c.lock.held).toBe(false);
});

test('a busy lock skips the run', () => {
  const c = ctx(sheet());
  c.lock.tryLock = () => false;
  expect(lib.Provision.run(c, { drive: fakeDrive() }).skipped).toBe(true);
});

describe('renaming in the sheet renames the folder', () => {
  const ana = { client_id: 'CL-AAAAAA', name: 'Ana Ferreira', email: 'ana@x.pt', active: true, provision_status: 'PENDING' };
  const anaCase = { case_id: 'CS-111111', client_id: 'CL-AAAAAA', case_name: 'Acidente de viação', status: 'open', provision_status: 'PENDING' };

  test('a renamed case and client get their folders renamed on the next run, once', () => {
    const ss = sheet({ clients: [ana], cases: [anaCase] });
    const drive = fakeDrive();
    const c = ctx(ss);
    lib.Provision.run(c, { drive });
    expect(lib.Provision.hasRenames(c)).toBe(false);

    lib.Cases.table(ss).update(caseRows(ss)[0]._row, { case_name: 'Reagrupamento familiar' });
    lib.Clients.table(ss).update(clientRows(ss)[0]._row, { name: 'Ana F. Silva' });
    expect(lib.Provision.hasWork(ss)).toBe(false);
    expect(lib.Provision.hasRenames(c)).toBe(true);

    expect(lib.Provision.run(c, { drive }).renamed).toBe(2);
    expect(drive.renamed).toEqual([
      { id: 'F1', name: 'Ana F. Silva [CL-AAAAAA]' },
      { id: 'F2', name: 'Reagrupamento familiar [CS-111111]' },
    ]);
    expect(drive.gets).toEqual([]);  // names it gave itself are known: no Drive reads
    expect(lib.Provision.hasRenames(c)).toBe(false);
    expect(lib.Provision.run(c, { drive }).renamed).toBe(0);
  });

  test('folders made before this existed are read once and renamed only if they differ', () => {
    const ss = sheet({
      clients: [{ ...ana, provision_status: 'ACTIVE', folder_id: 'OLD1' }],
      cases: [{ ...anaCase, case_name: 'Reagrupamento familiar', provision_status: 'ACTIVE', folder_id: 'OLD2' }],
    });
    const drive = fakeDrive({ folders: { OLD1: { name: 'Ana Ferreira [CL-AAAAAA]' }, OLD2: { name: 'Acidente de viação [CS-111111]' } } });
    const c = ctx(ss);
    expect(lib.Provision.hasRenames(c)).toBe(true);
    expect(lib.Provision.run(c, { drive }).renamed).toBe(1);
    expect(drive.gets).toEqual(['OLD1', 'OLD2']);
    expect(drive.renamed).toEqual([{ id: 'OLD2', name: 'Reagrupamento familiar [CS-111111]' }]);
    lib.Provision.run(c, { drive });
    expect(drive.gets).toHaveLength(2);
  });

  test('a folder that is gone or trashed is left alone and not asked about again', () => {
    const ss = sheet({
      clients: [{ ...ana, name: 'Ana Nova', provision_status: 'ACTIVE', folder_id: 'GONE' }],
      cases: [{ ...anaCase, provision_status: 'ACTIVE', folder_id: 'BIN' }],
    });
    const drive = fakeDrive({ folders: { BIN: { name: 'Old [CS-111111]', trashed: true } } });
    const c = ctx(ss);
    expect(lib.Provision.run(c, { drive }).renamed).toBe(0);
    expect(drive.folders.BIN.name).toBe('Old [CS-111111]');
    expect(lib.Provision.hasRenames(c)).toBe(false);
  });

  test('a Drive error leaves the name unknown, so the next run tries again', () => {
    const ss = sheet({ clients: [{ ...ana, provision_status: 'ACTIVE', folder_id: 'F9' }] });
    const drive = fakeDrive({ folders: { F9: { name: 'Ana [CL-AAAAAA]' } } });
    drive.get = () => { throw lib.Errors.make('drive', 'Drive 500', { status: 500 }); };
    const c = ctx(ss);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(lib.Provision.run(c, { drive }).renamed).toBe(0);
    spy.mockRestore();
    expect(lib.Provision.hasRenames(c)).toBe(true);
  });
});
