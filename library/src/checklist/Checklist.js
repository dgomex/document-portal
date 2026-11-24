/**
 * Builds a case's document checklist: the requirements of the case's
 * process type in the firm's own lists (FirmLists), filtered by the case's
 * facts, and multiplied out per person. Pure: no sheet or Drive access (CaseChecklist
 * does the I/O), so every rule here is unit-tested.
 *
 * An item: { key, person_id, person_name, doc_type, options, level, source,
 *   title, instructions, text: { title: {pt,en,es}, instructions: {...}, options: [{doc, title}] } }
 * key = requirement key + '|' + (person_id or 'case'); it ties a rebuilt item
 * to the row that already holds its status and uploads.
 */
const Checklist = (function () {
  /** The facts that hold for a case: ticked ones plus those the people imply. */
  function facts(ticked, people) {
    const out = new Set(String(ticked || '').normalize('NFC').split(/[\s,;]+/).map(function (f) { return f.trim().toLowerCase(); }).filter(String));
    (people || []).forEach(function (p) {
      if (p.role === 'spouse') out.add('married');
      if (p.role === 'child') out.add('children');
    });
    return out;
  }

  /** Whole years from a birth date (Date or YYYY-MM-DD) to now; null if unknown. */
  function age(birthDate, now) {
    const day = Validate.ymd(birthDate);
    const b = day ? new Date(day + 'T00:00:00Z') : null;
    if (!b || isNaN(b.getTime())) return null;
    const n = new Date(now || Date.now());
    let years = n.getUTCFullYear() - b.getUTCFullYear();
    if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) years--;
    return years;
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

  /**
   * input: { requirements: the process type's requirements (FirmLists), each
   *          carrying its own text, facts: 'cplp;meios_a', people: [{person_id, name, role, birth_date}],
   *          lang: firm language for the title/instructions columns, now }
   */
  function build(input) {
    const people = input.people || [];
    const have = facts(input.facts, people);
    const lang = input.lang || 'pt';
    const items = [];
    (input.requirements || []).forEach(function (r) {
      if ((r.only_if || []).some(function (f) { return !have.has(f); })) return;
      if ((r.unless || []).some(function (f) { return have.has(f); })) return;
      const text = r.text;
      targets_(r, people, input.now).forEach(function (p) {
        items.push({
          key: r.key + '|' + (p ? p.person_id : 'case'),
          person_id: p ? p.person_id : '', person_name: p ? p.name : '',
          doc_type: r.doc || (r.any_of ? r.key : r.key), options: r.any_of ? r.any_of.join(';') : '',
          level: r.level, source: r.source,
          title: Text.pick(text.title, lang), instructions: Text.pick(text.instructions, lang),
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
        Config.LANGUAGES.some(function (l) { return String(row.reason || '') === I18n.t(l, 'checklist.noLongerApplies'); });
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

  return { facts: facts, age: age, build: build, merge: merge };
})();
