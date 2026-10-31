/**
 * Builds a case's document checklist: catalog requirements for the visa,
 * changed by the firm's adjustments, filtered by the case's facts, and
 * multiplied out per person. Pure: no sheet or Drive access (CaseChecklist
 * does the I/O), so every rule here is unit-tested.
 *
 * An item: { key, person_id, person_name, doc_type, options, level, source,
 *   title, instructions, text: { title: {pt,en,es}, instructions: {...}, options: [{doc, title}] } }
 * key = requirement key + '|' + (person_id or 'case'); it ties a rebuilt item
 * to the row that already holds its status and uploads.
 */
const Checklist = (function () {
  const FIRM_PREFIX = 'FIRM-';

  /** The facts that hold for a case: ticked ones plus those the people imply. */
  function facts(ticked, people) {
    const out = new Set(String(ticked || '').split(/[\s,;]+/).map(function (f) { return f.trim().toLowerCase(); }).filter(String));
    (people || []).forEach(function (p) {
      if (p.role === 'spouse') out.add('married');
      if (p.role === 'child') out.add('children');
    });
    return out;
  }

  /** Whole years from a birth date (Date or YYYY-MM-DD) to now; null if unknown. */
  function age(birthDate, now) {
    const b = birthDate instanceof Date ? birthDate : /^\d{4}-\d{2}-\d{2}$/.test(String(birthDate || '')) ? new Date(String(birthDate) + 'T00:00:00Z') : null;
    if (!b || isNaN(b.getTime())) return null;
    const n = new Date(now || Date.now());
    let years = n.getUTCFullYear() - b.getUTCFullYear();
    if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) years--;
    return years;
  }

  function same_(lang) {
    // The firm's own words: shown as typed, whatever the client's language.
    const out = {};
    Catalog.data().languages.forEach(function (l) { out[l] = lang; });
    return out;
  }

  function slug_(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  }

  /** The visa's requirements after the firm's adjustments (rows of the Adjustments tab). */
  function requirements(visaId, adjustments) {
    const visa = Catalog.visa(visaId);
    if (!visa) return [];
    let reqs = visa.requirements.map(function (r) { return Object.assign({ source: 'catalog', titleOverride: '', note: '' }, r); });
    (adjustments || []).filter(function (a) {
      const v = String(a.visa_type || '').trim();
      return v === '' || v === '*' || v === visaId;
    }).forEach(function (a) {
      const action = String(a.action || '').trim().toLowerCase();
      const key = String(a.doc_type || '').trim();
      const appliesTo = String(a.applies_to || '').trim();
      const matches = function (r) { return r.key === key && (!appliesTo || r.applies_to === appliesTo); };
      if (action === 'hide') {
        reqs = reqs.filter(function (r) { return !matches(r); });
      } else if (action === 'change') {
        reqs.forEach(function (r) {
          if (!matches(r)) return;
          if (a.level) r.level = String(a.level).trim();
          if (a.title) r.titleOverride = String(a.title).trim();
          if (a.note) r.note = String(a.note).trim();
          r.source = 'firm';
        });
      } else if (action === 'add') {
        const known = Catalog.docType(key);
        const newKey = known ? key : FIRM_PREFIX + slug_(key || a.title);
        if (newKey === FIRM_PREFIX) return;  // nothing to identify it by
        reqs.push({
          key: newKey, doc: known ? key : null, any_of: null, name: null, source: 'firm',
          applies_to: Config.APPLIES_TO.indexOf(appliesTo) !== -1 ? appliesTo : 'main_applicant',
          level: String(a.level || 'required').trim(), only_if: [], unless: [], min_age: appliesTo === 'each_adult' ? 16 : null,
          titleOverride: String(a.title || (known ? '' : key)).trim(), note: String(a.note || '').trim(),
        });
      }
    });
    return reqs;
  }

  function targets_(r, people, now) {
    switch (r.applies_to) {
      case 'case': return [null];
      case 'main_applicant': return people.filter(function (p) { return p.role === 'main_applicant'; });
      case 'spouse': return people.filter(function (p) { return p.role === 'spouse'; });
      case 'each_child': return people.filter(function (p) { return p.role === 'child'; });
      case 'each_person': return people;
      case 'each_adult': return people.filter(function (p) {
        const years = age(p.birth_date, now);
        return years === null ? p.role !== 'child' : years >= (r.min_age || 16);
      });
      default: return [];
    }
  }

  function text_(r) {
    const langs = Catalog.data().languages;
    const join = function (a, b) {
      const out = {};
      langs.forEach(function (l) {
        out[l] = [a && a[l], b && b[l]].map(function (s) { return String(s || '').trim(); }).filter(Boolean).join(' ');
      });
      return out;
    };
    let title;
    let instructions;
    let options = [];
    if (r.any_of) {
      title = r.name;
      options = r.any_of.map(function (d) { return { doc: d, title: Catalog.docType(d).name }; });
      instructions = {};
    } else if (r.doc) {
      const d = Catalog.docType(r.doc);
      title = d.name;
      instructions = join(d.instructions, Catalog.ruleNotes(d.rules));
    } else {
      title = same_('');
      instructions = {};
    }
    if (r.titleOverride) title = same_(r.titleOverride);
    if (r.note) instructions = join(instructions, same_(r.note));
    return { title: title, instructions: instructions, options: options };
  }

  /**
   * input: { visaId, facts: 'cplp;other_residence', people: [{person_id, name, role, birth_date}],
   *          adjustments: [...rows], lang: firm language for the title/instructions columns, now }
   */
  function build(input) {
    const people = input.people || [];
    const have = facts(input.facts, people);
    const lang = input.lang || 'pt';
    const items = [];
    requirements(input.visaId, input.adjustments).forEach(function (r) {
      if (r.only_if.some(function (f) { return !have.has(f); })) return;
      if (r.unless.some(function (f) { return have.has(f); })) return;
      const text = text_(r);
      targets_(r, people, input.now).forEach(function (p) {
        items.push({
          key: r.key + '|' + (p ? p.person_id : 'case'),
          person_id: p ? p.person_id : '', person_name: p ? p.name : '',
          doc_type: r.doc || (r.any_of ? r.key : r.key), options: r.any_of ? r.any_of.join(';') : '',
          level: r.level, source: r.source,
          title: Catalog.text(text.title, lang), instructions: Catalog.text(text.instructions, lang),
          text: text,
        });
      });
    });
    return items;
  }

  /**
   * How to bring a case's existing rows in line with a fresh build:
   * { create: [items], update: [{ row, partial }] }. Statuses, reasons,
   * uploads and due dates are never touched; the lawyer's ad-hoc rows
   * (source 'case') are left alone; items that no longer apply are waived,
   * never deleted.
   */
  function merge(existing, fresh, lang) {
    const byKey = {};
    (existing || []).forEach(function (row) { if (row.key && row.source !== 'case') byKey[row.key] = row; });
    const freshKeys = new Set();
    const out = { create: [], update: [] };
    fresh.forEach(function (item) {
      freshKeys.add(item.key);
      const row = byKey[item.key];
      if (!row) return out.create.push(item);
      const partial = {
        title: item.title, instructions: item.instructions, person_name: item.person_name,
        doc_type: item.doc_type, source: item.source, text_json: JSON.stringify(item.text),
      };
      // The lawyer's waivers stay; items the portal itself waived (no longer
      // applied) come back when they apply again.
      const autoWaived = row.level === Config.ITEM_LEVEL.WAIVED &&
        Catalog.data().languages.some(function (l) { return String(row.reason || '') === I18n.t(l, 'checklist.noLongerApplies'); });
      if (row.level !== Config.ITEM_LEVEL.WAIVED || autoWaived) partial.level = item.level;
      if (autoWaived) partial.reason = '';
      out.update.push({ row: row, partial: partial });
    });
    Object.keys(byKey).forEach(function (key) {
      const row = byKey[key];
      if (freshKeys.has(key) || row.level === Config.ITEM_LEVEL.WAIVED) return;
      out.update.push({ row: row, partial: { level: Config.ITEM_LEVEL.WAIVED, reason: I18n.t(lang || 'pt', 'checklist.noLongerApplies') } });
    });
    return out;
  }

  return { facts: facts, age: age, requirements: requirements, build: build, merge: merge, FIRM_PREFIX: FIRM_PREFIX };
})();
