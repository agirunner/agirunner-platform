import {
  parseSkillMarkdown,
  parseYamlDocument,
} from './community-catalog-parser.js';
import type {
  CommunityCatalogLoadedPlaybook,
  CommunityCatalogLoadedSkill,
  CommunityCatalogLoadedSpecialist,
  CommunityCatalogPlaybookPackage,
  CommunityCatalogPlaybookManifestEntry,
  CommunityCatalogSelection,
  CommunityCatalogSkillManifestEntry,
  CommunityCatalogSpecialistManifestEntry,
} from './community-catalog-types.js';

interface ToolProfileManifest {
  tool_profiles?: Array<{ id?: string; tools?: string[] }>;
}

export class CommunityCatalogSourceService {
  private readonly repository: string;
  private readonly ref: string;
  private readonly rawBaseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(input?: {
    repository?: string;
    ref?: string;
    rawBaseUrl?: string;
    fetcher?: typeof fetch;
  }) {
    this.repository = input?.repository ?? 'agirunner/agirunner-playbooks';
    this.ref = input?.ref ?? 'main';
    this.rawBaseUrl = (input?.rawBaseUrl ?? 'https://raw.githubusercontent.com').replace(/\/+$/, '');
    this.fetcher = input?.fetcher ?? fetch;
  }

  async listPlaybooks(): Promise<CommunityCatalogPlaybookManifestEntry[]> {
    const manifest = await this.loadPlaybookManifest();
    return manifest.playbooks;
  }

  async getPlaybookDetail(id: string): Promise<CommunityCatalogPlaybookPackage> {
    const selection = await this.loadSelection([id]);
    const pkg = selection.packages[0];
    if (!pkg) {
      throw new Error(`Catalog playbook "${id}" not found`);
    }
    return pkg;
  }

  async loadSelection(playbookIds: string[]): Promise<CommunityCatalogSelection> {
    const uniqueIds = Array.from(new Set(playbookIds.map((value) => value.trim()).filter(Boolean)));
    if (uniqueIds.length === 0) {
      throw new Error('At least one playbook id is required');
    }

    const [playbookManifest, specialistManifest, skillManifest, toolProfileManifest] =
      await Promise.all([
        this.loadPlaybookManifest(),
        this.loadSpecialistManifest(),
        this.loadSkillManifest(),
        this.loadToolProfiles(),
      ]);

    const playbookEntries = uniqueIds.map((id) => {
      const entry = playbookManifest.playbooks.find((candidate) => candidate.id === id);
      if (!entry) {
        throw new Error(`Catalog playbook "${id}" not found`);
      }
      return entry;
    });

    const packages = await Promise.all(
      playbookEntries.map((entry) =>
        this.loadPlaybookPackage(entry, specialistManifest.specialists, skillManifest.skills),
      ),
    );

    return {
      repository: this.repository,
      ref: this.ref,
      toolProfiles: Object.fromEntries(
        toolProfileManifest.tool_profiles?.flatMap((profile) =>
          profile.id ? [[profile.id, profile.tools ?? []]] : [],
        ) ?? [],
      ),
      packages,
    };
  }

  private async loadPlaybookPackage(
    manifestEntry: CommunityCatalogPlaybookManifestEntry,
    specialists: CommunityCatalogSpecialistManifestEntry[],
    skills: CommunityCatalogSkillManifestEntry[],
  ) {
    const [playbookText, readmeText] = await Promise.all([
      this.fetchText(manifestEntry.path),
      this.fetchText(manifestEntry.path.replace(/playbook\.yaml$/, 'README.md')),
    ]);
    const parsedPlaybook = parseYamlDocument<Record<string, unknown>>(playbookText, manifestEntry.path);
    const playbook = this.normalizeLoadedPlaybook(manifestEntry, parsedPlaybook, readmeText);

    const specialistEntries = manifestEntry.specialist_ids.map((specialistId) => {
      const entry = specialists.find((candidate) => candidate.id === specialistId);
      if (!entry) {
        throw new Error(
          `Catalog specialist "${specialistId}" referenced by "${manifestEntry.id}" was not found`,
        );
      }
      return entry;
    });

    const loadedSpecialists = await Promise.all(
      specialistEntries.map(async (entry) => {
        const text = await this.fetchText(entry.path);
        return this.normalizeLoadedSpecialist(entry, parseYamlDocument<Record<string, unknown>>(text, entry.path));
      }),
    );

    const neededSkillIds = Array.from(
      new Set(loadedSpecialists.flatMap((specialist) => specialist.skillIds)),
    );
    const skillEntries = neededSkillIds.map((skillId) => {
      const entry = skills.find((candidate) => candidate.id === skillId);
      if (!entry) {
        throw new Error(`Catalog skill "${skillId}" referenced by "${manifestEntry.id}" was not found`);
      }
      return entry;
    });

    const loadedSkills = await Promise.all(
      skillEntries.map(async (entry) => {
        const text = await this.fetchText(entry.path);
        return this.normalizeLoadedSkill(entry, text);
      }),
    );

    return {
      playbook,
      specialists: loadedSpecialists,
      skills: loadedSkills,
    };
  }

  private normalizeLoadedPlaybook(
    manifestEntry: CommunityCatalogPlaybookManifestEntry,
    parsed: Record<string, unknown>,
    readmeText: string,
  ): CommunityCatalogLoadedPlaybook {
    return {
      id: readString(parsed.id) ?? manifestEntry.id,
      path: manifestEntry.path,
      readmePath: manifestEntry.path.replace(/playbook\.yaml$/, 'README.md'),
      readme: readmeText.trim(),
      name: readString(parsed.name) ?? manifestEntry.name,
      slug: readString(parsed.slug) ?? manifestEntry.id,
      version: readString(parsed.version) ?? manifestEntry.version,
      category: readString(parsed.category) ?? manifestEntry.category,
      stability: (readString(parsed.stability) as CommunityCatalogLoadedPlaybook['stability']) ?? manifestEntry.stability,
      description: readString(parsed.description) ?? manifestEntry.summary,
      outcome: readString(parsed.outcome) ?? '',
      lifecycle: (readString(parsed.lifecycle) as CommunityCatalogLoadedPlaybook['lifecycle']) ?? 'planned',
      specialistIds: readStringArray(parsed.specialist_ids) ?? manifestEntry.specialist_ids,
      definition: asRecord(parsed.definition),
    };
  }

  private normalizeLoadedSpecialist(
    manifestEntry: CommunityCatalogSpecialistManifestEntry,
    parsed: Record<string, unknown>,
  ): CommunityCatalogLoadedSpecialist {
    return {
      id: readString(parsed.id) ?? manifestEntry.id,
      path: manifestEntry.path,
      name: readString(parsed.name) ?? manifestEntry.name,
      category: readString(parsed.category) ?? manifestEntry.category,
      stability: (readString(parsed.stability) as CommunityCatalogLoadedSpecialist['stability']) ?? manifestEntry.stability,
      description: readString(parsed.description) ?? manifestEntry.summary,
      allowedTools: readStringArray(parsed.allowed_tools) ?? readString(parsed.allowed_tools) ?? [],
      skillIds: readStringArray(parsed.skill_ids) ?? manifestEntry.skill_ids,
      systemPrompt: readString(parsed.system_prompt) ?? '',
    };
  }

  private normalizeLoadedSkill(
    manifestEntry: CommunityCatalogSkillManifestEntry,
    markdown: string,
  ): CommunityCatalogLoadedSkill {
    const parsed = parseSkillMarkdown(markdown);
    return {
      id: manifestEntry.id,
      path: manifestEntry.path,
      name: titleCaseFromKebab(parsed.name),
      category: manifestEntry.category,
      stability: manifestEntry.stability,
      summary: manifestEntry.summary,
      content: parsed.body,
    };
  }

  private loadPlaybookManifest() {
    return this.loadYamlManifest<{ playbooks: CommunityCatalogPlaybookManifestEntry[] }>('catalog/playbooks.yaml');
  }

  private loadSpecialistManifest() {
    return this.loadYamlManifest<{ specialists: CommunityCatalogSpecialistManifestEntry[] }>('catalog/specialists.yaml');
  }

  private loadSkillManifest() {
    return this.loadYamlManifest<{ skills: CommunityCatalogSkillManifestEntry[] }>('catalog/skills.yaml');
  }

  private loadToolProfiles() {
    return this.loadYamlManifest<ToolProfileManifest>('catalog/tool-profiles.yaml');
  }

  private async loadYamlManifest<T>(path: string): Promise<T> {
    const text = await this.fetchText(path);
    return parseYamlDocument<T>(text, path);
  }

  private async fetchText(path: string): Promise<string> {
    const response = await this.fetcher(this.buildRawUrl(path));
    if (!response.ok) {
      throw new Error(`Failed to fetch ${path}: HTTP ${response.status}`);
    }
    return response.text();
  }

  private buildRawUrl(path: string): string {
    return `${this.rawBaseUrl}/${this.repository}/${this.ref}/${path}`;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim());
}

function titleCaseFromKebab(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
