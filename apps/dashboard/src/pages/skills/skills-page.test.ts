import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(fileName: string) {
  return readFileSync(resolve(import.meta.dirname, fileName), 'utf8');
}

function readCombinedSource() {
  return ['./skills-page.tsx', './skills-page.api.ts', './skills-page.dialog.tsx']
    .map(readSource)
    .join('\n');
}

describe('skills page source', () => {
  it('adds a dedicated shared-skill management surface under specialists', () => {
    const source = readCombinedSource();

    expect(source).toContain('DashboardPageHeader');
    expect(source).toContain('navHref="/design/specialists/skills"');
    expect(source).toContain('Shared skills');
    expect(source).toContain('Create Skill');
    expect(source).toContain("queryKey: ['specialist-skills']");
    expect(source).toContain('fetchSpecialistSkills');
    expect(source).toContain('deleteSpecialistSkill');
  });

  it('uses the specialists pagination pattern after fetching the full skill list', () => {
    const source = readSource('./skills-page.tsx');

    expect(source).toContain('DEFAULT_LIST_PAGE_SIZE');
    expect(source).toContain('paginateListItems');
    expect(source).toContain('ListPagination');
    expect(source).toContain('const [page, setPage] = useState(1);');
    expect(source).toContain(
      'const [pageSize, setPageSize] = useState<number>(DEFAULT_LIST_PAGE_SIZE);',
    );
    expect(source).toContain('const pagination = paginateListItems(skills, page, pageSize);');
    expect(source).toContain('itemLabel="skills"');
    expect(source).toContain('onPageChange={setPage}');
    expect(source).toContain('setPageSize(value);');
    expect(source).toContain('setPage(1);');
  });

  it('supports create, edit, and delete without archive or restore actions', () => {
    const source = readCombinedSource();

    expect(source).toContain('Edit Skill');
    expect(source).toContain('Delete Skill');
    expect(source).toContain('Save Skill');
    expect(source).not.toContain('Archive skill');
    expect(source).not.toContain('Restore skill');
    expect(source).not.toContain('archiveSpecialistSkill');
    expect(source).not.toContain('unarchiveSpecialistSkill');
  });
});
