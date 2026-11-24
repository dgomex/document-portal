/**
 * The firm's own process types and document lists (schema 4): two tabs of
 * the firm's sheet, "Visa types" and "Document lists". They are the only
 * source of every case's document list: the portal ships no catalog. A new
 * firm starts with empty tabs and imports or types its own lists (the
 * portal-lists skill); a 0.4.x firm got its own stored lists copied in by the
 * schema 4 migration (admin/LegacyLists.js). This module turns the two tabs into the lists cases are
 * built from, and keeps the script-owned columns in order:
 *
 *   - IDs: a blank visa_type gets an ID from the type's name (F- prefix);
 *     a typed ID that is already valid stays as typed; other typed text is
 *     normalised the same way. A Document lists row may name its type
 *     instead of giving the ID.
 *   - Keys: doc_key and group_key tie a case's items to a row across edits,
 *     so renaming a document or a group never loses a received document.
 *     An item identity (group_key for grouped rows, else doc_key) is unique
 *     per visa type and overlapping applies_to (each_person and each_adult
 *     overlap every other value except case).
 *   - check: "ok", or what's wrong (errors skip the row, warnings don't).
 *
 * process() is pure (rows in, model + writes out), so every rule is
 * unit-tested; check() does the I/O.
 */
const FirmLists = (function () {
  const OWN_PREFIX = 'F-';
  const DOC_PREFIX = 'FIRM-';
  const GROUP_PREFIX = 'FIRM-G-';
  const MAX_ID = 40;
  const DERIVED_FACTS = ['married', 'children'];  // implied by the case's people
  const WIDE = ['each_person', 'each_adult'];     // may reach anyone in the case
  const CACHE_PART = 90000;                        // the cache keeps 100 KB per value
  const CACHE_TTL = 6 * 3600;
  const LANGS = ['pt', 'en', 'es'];
  // Client-facing columns: only these make a case's list "older" (§5).
  const HASHED_DOC_COLUMNS = ['order', 'applies_to', 'level', 'title_pt', 'title_en', 'title_es',
    'instructions_pt', 'instructions_en', 'instructions_es', 'group_pt', 'group_en', 'group_es', 'group_key',
    'only_if', 'unless', 'min_age', 'active', 'doc_key'];

  let memo_ = null;  // { hash, model } for this execution

  function tabs_() {
    return { types: Config.TABS.VISA_TYPES, docs: Config.TABS.DOC_LISTS };
  }

  function str_(v) {
    return v === null || v === undefined ? '' : String(v).trim();
  }

  function bool_(v) {
    return v === true || /^(true|1|yes|sim|sí|si|x|✓)$/i.test(str_(v));
  }

  function list_(v) {
    return str_(v).split(/[;,]+/).map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  }

  /** A condition Checklist.facts() would split in two (it splits a case's facts on spaces). */
  function badCondition_(c) {
    return /\s/.test(c);
  }

  function plain_(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  }

  /** A typed ID kept as it is: capitals, digits and dashes (PT-D7, F-AR-92). */
  function isId_(text) {
    return /^[A-Z0-9][A-Z0-9-]{0,39}$/.test(text);
  }

  /** IDs made from a name or from free text: dashes, F- prefix. */
  function ownId(text) {
    let s = plain_(text).replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!s) return '';
    if (s.indexOf(OWN_PREFIX) !== 0) s = OWN_PREFIX + s;
    return s.slice(0, MAX_ID).replace(/-+$/g, '');
  }

  /** Document and group keys: underscores, as Checklist does for Adjustments. */
  function keySlug_(text) {
    return plain_(text).replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, MAX_ID);
  }

  function unique_(base, taken, sep) {
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(base + sep + n)) return base + sep + n;
  }

  function overlap_(a, b) {
    if (a === b) return true;
    if (a === 'case' || b === 'case') return false;
    return WIDE.indexOf(a) !== -1 || WIDE.indexOf(b) !== -1;
  }

  /** { pt, en, es } from row[prefix + lang], empty languages filled from the firm's. */
  function texts_(row, prefix, lang) {
    const out = {};
    const fallback = str_(row[prefix + lang]);
    LANGS.forEach(function (l) { out[l] = str_(row[prefix + l]) || fallback; });
    return out;
  }

  function hash_(value) {
    return Crypto.sha256Hex(JSON.stringify(value)).slice(0, 10);
  }

  /**
   * The heart of it. typeRows/docRows: Table rows (objects with _row).
   * Returns { model, writes: { types: [{ row, partial }], docs: [...] }, problems: [{ tab, row, level, key, params }] }.
   * model: { lang, visas: { id: { id, name, active, offer, family, factsToAsk, listHash, requirements } }, order }.
   */
  function process(typeRows, docRows, lang) {
    lang = LANGS.indexOf(lang) !== -1 ? lang : 'pt';
    const T = tabs_();
    const problems = [];
    const writes = { types: [], docs: [] };
    const notes = {};  // tab|row -> [{ level, key, params }]
    const note = function (tab, row, level, key, params) {
      const k = tab + '|' + row;
      (notes[k] = notes[k] || []).push({ level: level, key: key, params: params || {} });
      problems.push({ tab: tab, row: row, level: level, key: key, params: params || {} });
    };
    const partials = {};  // tab|row -> partial
    const set = function (tab, row, partial) {
      const k = tab + '|' + row._row;
      partials[k] = Object.assign(partials[k] || { _tab: tab, _rowObj: row }, partial);
      Object.keys(partial).forEach(function (c) { row[c] = partial[c]; });
    };

    // 1. Visa types: IDs, names, duplicates.
    const types = {};
    const order = [];
    const byName = {};
    const taken = new Set();
    typeRows.forEach(function (r) {
      const raw = str_(r.visa_type);
      if (raw) taken.add(isId_(raw) ? raw : ownId(raw));
    });
    const seen = new Set();
    typeRows.forEach(function (r) {
      const name = str_(r['name_' + lang]);
      const raw = str_(r.visa_type);
      let id = '';
      if (!raw) {
        if (name) {
          id = unique_(ownId(name), new Set(Array.from(taken).concat(Array.from(seen))), '-');
          taken.add(id);
        }
      } else {
        id = isId_(raw) ? raw : ownId(raw);
      }
      if (!name) note(T.types, r._row, 'error', 'lists.check.noName', { lang: lang });
      // A fact asked with a space could never match a condition: the type still works, so a warning.
      list_(r.facts_to_ask).filter(badCondition_).forEach(function (c) {
        note(T.types, r._row, 'warning', 'lists.check.condition', { value: c });
      });
      if (id && seen.has(id)) {
        note(T.types, r._row, 'error', 'lists.check.dupType', { id: id });
        return;
      }
      if (!id) return;
      seen.add(id);
      if (id !== raw) set(T.types, r, { visa_type: id });
      if (!name) return;
      const t = {
        id: id, row: r._row, name: texts_(r, 'name_', lang), active: bool_(r.active), family: bool_(r.family),
        factsToAsk: list_(r.facts_to_ask), requirements: [], offer: false, listHash: '',
      };
      types[id] = t;
      order.push(id);
      const lower = name.toLowerCase();
      if (!(lower in byName)) byName[lower] = id;
    });

    // 2. Document lists: which type each row belongs to.
    const rowsByVisa = {};
    docRows.forEach(function (r) {
      const raw = str_(r.visa_type);
      let id = types[raw] ? raw : (!isId_(raw) && types[ownId(raw)] ? ownId(raw) : byName[raw.toLowerCase()]);
      if (!raw || !id) {
        note(T.docs, r._row, 'error', 'lists.check.noType', { value: raw });
        return;
      }
      if (id !== raw) set(T.docs, r, { visa_type: id });
      (rowsByVisa[id] = rowsByVisa[id] || []).push(r);
    });

    // 3. Per visa type: keys, validation, requirements.
    Object.keys(rowsByVisa).forEach(function (visaId) {
      const rows = rowsByVisa[visaId];
      const keys = new Set();
      rows.forEach(function (r) {
        if (str_(r.doc_key)) keys.add(str_(r.doc_key));
        if (str_(r.group_key)) keys.add(str_(r.group_key));
      });
      const nameToKey = {};
      rows.forEach(function (r) {
        const g = str_(r['group_' + lang]).toLowerCase();
        if (g && str_(r.group_key) && !(g in nameToKey)) nameToKey[g] = str_(r.group_key);
      });

      // 3a. Keys for new rows and groups.
      rows.forEach(function (r) {
        const groupName = str_(r['group_' + lang]);
        if (!groupName && str_(r.group_key)) {
          set(T.docs, r, { group_key: '' });
          note(T.docs, r._row, 'warning', 'lists.check.leftGroup');
        } else if (groupName && !str_(r.group_key)) {
          const lower = groupName.toLowerCase();
          if (!nameToKey[lower]) {
            nameToKey[lower] = unique_(GROUP_PREFIX + (keySlug_(groupName) || 'GROUP'), keys, '_');
            keys.add(nameToKey[lower]);
          }
          set(T.docs, r, { group_key: nameToKey[lower] });
        }
        if (!str_(r.doc_key)) {
          const title = str_(r['title_' + lang]) || LANGS.map(function (l) { return str_(r['title_' + l]); }).filter(String)[0] || 'DOC';
          const dk = unique_(DOC_PREFIX + (keySlug_(title) || 'DOC'), keys, '_');
          keys.add(dk);
          set(T.docs, r, { doc_key: dk });
        }
      });

      // 3b. Groups and copied keys. A group is identified by its group_key
      // within a scope of people: the same key used for people that never
      // overlap (spouse, each_child) is a separate group, as for plain keys.
      // A row repeating an option of its group is a copy: with the group's
      // text and people, an extra option (new doc_key); with other text, or
      // for other people that overlap (main_applicant -> each_adult), a copied
      // group (new group_key). Groups claim their keys first, then plain rows.
      const appliesOf = function (r) { return str_(r.applies_to) || 'main_applicant'; };
      const claims = [];  // { id, applies, row, group }
      const byKey = {};   // group_key -> [group]
      let groupCount = 0;
      const newGroup = function (key, r, applies) {
        const g = { id: ++groupCount, key: key, first: r, applies: applies, docKeys: {}, copies: [] };
        (byKey[key] = byKey[key] || []).push(g);
        claims.push({ id: key, applies: applies, row: r._row, group: g.id });
        return g;
      };
      const textOf = function (r) { return str_(r['group_' + lang]).toLowerCase(); };
      rows.forEach(function (r) {
        const gk = str_(r.group_key);
        if (!gk) return;
        const applies = appliesOf(r);
        const same = byKey[gk] || [];
        let g = same.filter(function (e) { return e.applies === applies; })[0] ||
          same.filter(function (e) { return overlap_(e.applies, applies); })[0];
        if (!g) g = newGroup(gk, r, applies);
        const dk = str_(r.doc_key);
        if (g.docKeys[dk] && (textOf(r) !== textOf(g.first) || applies !== g.applies)) {
          const from = g.docKeys[dk];
          let copy = g.copies.filter(function (c) { return textOf(c.first) === textOf(r) && c.applies === applies && !c.docKeys[dk]; })[0];
          if (!copy) {
            const fresh = unique_(gk, keys, '_');
            keys.add(fresh);
            copy = newGroup(fresh, r, applies);
            g.copies.push(copy);
          }
          set(T.docs, r, { group_key: copy.key });
          note(T.docs, r._row, 'warning', 'lists.check.keyCopied', { row: from });
          g = copy;
        } else if (g.docKeys[dk]) {
          const fresh = unique_(dk, keys, '_');
          keys.add(fresh);
          set(T.docs, r, { doc_key: fresh });
          note(T.docs, r._row, 'warning', 'lists.check.keyCopied', { row: g.docKeys[dk] });
        } else if (textOf(r) !== textOf(g.first)) {
          note(T.docs, r._row, 'warning', 'lists.check.groupName', { row: g.first._row });
        }
        g.docKeys[str_(r.doc_key)] = r._row;
        r._grp = g.id;
      });
      rows.forEach(function (r) {
        if (str_(r.group_key)) return;
        const dk = str_(r.doc_key);
        const clash = claims.filter(function (c) { return c.id === dk && overlap_(c.applies, appliesOf(r)); })[0];
        if (clash) {
          const fresh = unique_(dk, keys, '_');
          keys.add(fresh);
          set(T.docs, r, { doc_key: fresh });
          note(T.docs, r._row, 'warning', 'lists.check.keyCopied', { row: clash.row });
        }
        claims.push({ id: str_(r.doc_key), applies: appliesOf(r), row: r._row, group: null });
      });

      // 3c. Validation of active rows.
      const visa = types[visaId];
      const valid = [];
      rows.forEach(function (r, i) {
        if (!bool_(r.active)) return;
        const applies = appliesOf(r);
        const level = str_(r.level).toLowerCase() || 'required';
        let bad = false;
        if (Config.APPLIES_TO.indexOf(applies) === -1) { note(T.docs, r._row, 'error', 'lists.check.appliesTo', { value: applies }); bad = true; }
        if (['required', 'optional'].indexOf(level) === -1) { note(T.docs, r._row, 'error', 'lists.check.level', { value: str_(r.level) }); bad = true; }
        if (!str_(r['title_' + lang])) { note(T.docs, r._row, 'error', 'lists.check.noTitle', { lang: lang }); bad = true; }
        const minAge = str_(r.min_age);
        if (minAge && !/^\d{1,3}$/.test(minAge)) { note(T.docs, r._row, 'error', 'lists.check.minAge', { value: minAge }); bad = true; }
        // A case's facts are split on spaces too, so a condition must be one word (accents are fine).
        list_(r.only_if).concat(list_(r.unless)).filter(badCondition_).forEach(function (c) {
          note(T.docs, r._row, 'error', 'lists.check.condition', { value: c });
          bad = true;
        });
        if (bad) return;
        const missing = LANGS.filter(function (l) { return l !== lang && !str_(r['title_' + l]); });
        if (missing.length) note(T.docs, r._row, 'warning', 'lists.check.noTranslation', { langs: missing.join(', ').toUpperCase() });
        const conds = list_(r.only_if).concat(list_(r.unless));
        const unasked = conds.filter(function (c) { return DERIVED_FACTS.indexOf(c) === -1 && visa.factsToAsk.indexOf(c) === -1; });
        if (unasked.length) note(T.docs, r._row, 'warning', 'lists.check.unasked', { facts: unasked.join(', ') });
        const ord = str_(r.order);
        valid.push({
          r: r, index: i, order: /^-?\d+(\.\d+)?$/.test(ord) ? Number(ord) : null,
          applies: applies, level: level, only_if: list_(r.only_if), unless: list_(r.unless),
          min_age: minAge ? Number(minAge) : (applies === 'each_adult' ? 16 : null),
        });
      });
      // Display order: rows with an order first, by order; then the rest; ties by sheet order.
      valid.sort(function (a, b) {
        if (a.order !== null && b.order !== null && a.order !== b.order) return a.order - b.order;
        if ((a.order === null) !== (b.order === null)) return a.order === null ? 1 : -1;
        return a.index - b.index;
      });

      // 3d. Requirements: one per plain row, one per group (at its first row).
      const done = {};
      valid.forEach(function (v) {
        const gk = str_(v.r.group_key);
        if (!gk) {
          visa.requirements.push(requirement_(v, str_(v.r.doc_key), [v], lang));
          return;
        }
        if (done[v.r._grp]) return;
        done[v.r._grp] = true;
        const members = valid.filter(function (w) { return w.r._grp === v.r._grp; });
        const first = members[0];
        members.slice(1).forEach(function (w) {
          const differs = ['applies', 'level', 'min_age'].some(function (f) { return w[f] !== first[f]; }) ||
            w.only_if.join(';') !== first.only_if.join(';') || w.unless.join(';') !== first.unless.join(';') ||
            LANGS.some(function (l) { return str_(w.r['group_' + l]) !== str_(first.r['group_' + l]); });
          if (differs) note(T.docs, w.r._row, 'warning', 'lists.check.groupDiffers', { row: first.r._row });
        });
        if (members.length === 1) note(T.docs, first.r._row, 'warning', 'lists.check.groupOfOne');
        visa.requirements.push(requirement_(first, gk, members, lang));
      });
      visa.offer = visa.requirements.length > 0;
    });

    // 4. List hashes (client-facing columns only), after the writes above.
    order.forEach(function (id) {
      const t = types[id];
      const tr = typeRows.filter(function (r) { return r._row === t.row; })[0];
      types[id].listHash = hash_([id, str_(tr.name_pt), str_(tr.name_en), str_(tr.name_es),
        (rowsByVisa[id] || []).map(function (r) {
          return HASHED_DOC_COLUMNS.map(function (c) { return c === 'active' ? bool_(r[c]) : str_(r[c]); });
        })]);
    });

    // 5. The check column: written only when it changes.
    const checkText = function (tab, row, current) {
      const list = notes[tab + '|' + row] || [];
      const text = list.length ? list.map(function (n) { return I18n.t(lang, n.key, n.params); }).join(' · ') : 'ok';
      return text === str_(current) ? null : text;
    };
    typeRows.forEach(function (r) {
      const t = checkText(T.types, r._row, r.check);
      if (t !== null) set(T.types, r, { check: t });
    });
    docRows.forEach(function (r) {
      const t = bool_(r.active) || (notes[T.docs + '|' + r._row] || []).length ? checkText(T.docs, r._row, r.check) : (str_(r.check) ? '' : null);
      if (t !== null) set(T.docs, r, { check: t });
    });
    Object.keys(partials).forEach(function (k) {
      const p = partials[k];
      const tab = p._tab;
      const row = p._rowObj;
      delete p._tab;
      delete p._rowObj;
      (tab === T.types ? writes.types : writes.docs).push({ row: row._row, partial: p });
    });

    return { model: { lang: lang, visas: types, order: order }, writes: writes, problems: problems };
  }

  /** A requirement in the shape Checklist.build() uses, carrying its own text. */
  function requirement_(first, key, members, lang) {
    const grouped = members.length > 1;
    const r = first.r;
    let text;
    if (grouped) {
      const instructions = {};
      let any = false;
      LANGS.forEach(function (l) {
        const each = members.map(function (w) { return texts_(w.r, 'instructions_', lang)[l]; });
        if (each.some(Boolean)) any = true;
        // The same text on every option is the group's own instructions; otherwise each option's, by title.
        instructions[l] = each[0] && each.every(function (x) { return x === each[0]; }) ? each[0]
          : members.map(function (w, k) { return each[k] ? texts_(w.r, 'title_', lang)[l] + ': ' + each[k] : ''; }).filter(Boolean).join(' ');
      });
      text = {
        title: texts_(r, 'group_', lang),
        instructions: any ? instructions : {},  // as 0.4.2 for groups without any
        options: members.map(function (w) { return { doc: str_(w.r.doc_key), title: texts_(w.r, 'title_', lang) }; }),
      };
    } else {
      text = { title: texts_(r, 'title_', lang), instructions: texts_(r, 'instructions_', lang), options: [] };
    }
    return {
      key: key, doc: grouped ? null : str_(r.doc_key),
      any_of: grouped ? members.map(function (w) { return str_(w.r.doc_key); }) : null,
      applies_to: first.applies, level: first.level, only_if: first.only_if, unless: first.unless,
      min_age: first.min_age, source: 'firm', text: text,
    };
  }

  /** Whether this sheet builds cases from its own lists (schema 4 and both tabs). */
  function enabled(ss) {
    const T = tabs_();
    if (!ss.getSheetByName(Config.TABS.SETTINGS) || !ss.getSheetByName(T.types) || !ss.getSheetByName(T.docs)) return false;
    return Number(Settings.get(ss, 'schema_version')) >= 4;
  }

  function read_(ss) {
    const T = tabs_();
    return { types: Table.open(ss, T.types).rows(), docs: Table.open(ss, T.docs).rows() };
  }

  /**
   * The firm's lists for this execution, without writing anything (the page,
   * reminders). Parsed lists are cached in ctx.cache, keyed by a hash of the
   * tabs; the tabs are always the truth.
   */
  function get(ss, cache) {
    const raw = read_(ss);
    const lang = Settings.language(ss);
    const copy = function (rows) { return rows.map(function (r) { return Object.assign({}, r); }); };  // process() fills in keys
    const hash = hash_([lang, raw.types, raw.docs]);
    if (memo_ && memo_.hash === hash) return memo_.model;
    let model = cache ? cacheRead_(cache, hash) : null;
    if (!model) {
      model = process(copy(raw.types), copy(raw.docs), lang).model;
      if (cache) cacheWrite_(cache, hash, model);
    }
    memo_ = { hash: hash, model: model };
    return model;
  }

  function cacheRead_(cache, hash) {
    try {
      const n = Number(cache.get('lists:' + hash));
      if (!n) return null;
      const parts = [];
      for (let i = 0; i < n; i++) {
        const p = cache.get('lists:' + hash + ':' + i);
        if (p === null || p === undefined) return null;  // a part expired: rebuild from the tabs
        parts.push(p);
      }
      return JSON.parse(parts.join(''));
    } catch (err) {
      return null;
    }
  }

  function cacheWrite_(cache, hash, model) {
    try {
      const text = JSON.stringify(model);
      const n = Math.ceil(text.length / CACHE_PART) || 1;
      for (let i = 0; i < n; i++) cache.put('lists:' + hash + ':' + i, text.slice(i * CACHE_PART, (i + 1) * CACHE_PART), CACHE_TTL);
      cache.put('lists:' + hash, String(n), CACHE_TTL);  // written last: a reader never sees half a model
    } catch (err) {
      console.warn('lists cache: ' + err);
    }
  }

  /**
   * Fills IDs, keys and the check column, then returns { model, summary }.
   * Run by the sync (under the script lock) and by the Verificar menu.
   */
  function check(ss) {
    const T = tabs_();
    const raw = read_(ss);
    const out = process(raw.types, raw.docs, Settings.language(ss));
    const typesTable = Table.open(ss, T.types);
    const docsTable = Table.open(ss, T.docs);
    out.writes.types.forEach(function (w) { typesTable.update(w.row, w.partial); });
    out.writes.docs.forEach(function (w) { docsTable.update(w.row, w.partial); });
    memo_ = null;
    return { model: out.model, problems: out.problems, summary: summary_(out) };
  }

  /** Like check(), without writing anything: for the sidebar, which runs outside the script lock. */
  function inspect(ss) {
    const raw = read_(ss);
    const copy = function (rows) { return rows.map(function (r) { return Object.assign({}, r); }); };
    const out = process(copy(raw.types), copy(raw.docs), Settings.language(ss));
    return { model: out.model, problems: out.problems, summary: summary_(out) };
  }

  function summary_(out) {
    const visas = out.model.order.map(function (id) { return out.model.visas[id]; });
    return {
      types: visas.length,
      documents: visas.reduce(function (n, v) { return n + v.requirements.length; }, 0),
      errors: out.problems.filter(function (p) { return p.level === 'error'; }).length,
      warnings: out.problems.filter(function (p) { return p.level === 'warning'; }).length,
    };
  }

  /** A process type by ID, from the firm's lists; null if it isn't there (or is broken). */
  function visa(model, id) {
    return model && model.visas[str_(id)] || null;
  }

  /** IDs for the Cases dropdown: types offered for new cases, plus any a case already uses. */
  function dropdownIds(model, usedIds) {
    const used = new Set((usedIds || []).map(str_).filter(Boolean));
    return model.order.filter(function (id) {
      const v = model.visas[id];
      return (v.active && v.offer) || used.has(id);
    });
  }

  /**
   * Writes rows into the two empty tabs (the schema 4 migration, from a 0.4.x
   * sheet's own stored lists). Keys and the check column are filled in memory
   * first, so each tab is written in one batch. Returns the type rows written.
   */
  function seed(ss, rows) {
    const T = tabs_();
    const typesTable = Table.open(ss, T.types);
    const docsTable = Table.open(ss, T.docs);
    if (typesTable.rows().length || docsTable.rows().length) return 0;  // safe to run twice
    rows.types.forEach(function (r, i) { r._row = i + 2; });
    rows.docs.forEach(function (r, i) { r._row = i + 2; });
    process(rows.types, rows.docs, Settings.language(ss));
    const clean = function (r) {  // without process()'s own markers (_row, _grp)
      const o = {};
      Object.keys(r).forEach(function (k) { if (k.charAt(0) !== '_') o[k] = r[k]; });
      return o;
    };
    typesTable.appendMany(rows.types.map(clean));
    docsTable.appendMany(rows.docs.map(clean));
    memo_ = null;
    return rows.types.length;
  }

  function reset_() { memo_ = null; }

  return { process: process, enabled: enabled, get: get, check: check, inspect: inspect, visa: visa, dropdownIds: dropdownIds,
    seed: seed, ownId: ownId, reset_: reset_, HASHED_DOC_COLUMNS: HASHED_DOC_COLUMNS };
})();
